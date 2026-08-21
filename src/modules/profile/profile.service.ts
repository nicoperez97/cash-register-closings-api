import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { readFileSync } from 'fs';
import { extname } from 'path';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { Shop } from '../../entities/shop.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { deleteUploadIfExists, resolveUploadPath, saveUploadFile } from '../../common/uploads';
import { eligibleNotificationsPayload } from './notification-eligibility';

const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function isUploadedAvatarPath(raw?: string | null): boolean {
  const v = (raw ?? '').trim().replace(/\\/g, '/');
  return !!v && !/^https?:\/\//i.test(v) && v.startsWith('users/');
}

function mimeFromPath(relativePath: string): string {
  const ext = extname(relativePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

export type UpdateProfileDto = {
  fullName?: string;
  phone?: string | null;
  bankAlias?: string | null;
  cbu?: string | null;
};

export type UpdateShopPreferencesDto = {
  navConfig?: Shop['navConfig'] | null;
  mutedNotificationTypes?: string[] | null;
};

@Injectable()
export class ProfileService implements OnModuleInit {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
  ) {}

  async onModuleInit() {
    const userCols: Array<[string, string]> = [
      ['avatarUrl', 'VARCHAR(500) NULL'],
      ['phone', 'VARCHAR(40) NULL'],
      ['bankAlias', 'VARCHAR(120) NULL'],
      ['cbu', 'VARCHAR(40) NULL'],
    ];
    for (const [col, def] of userCols) {
      try {
        await this.users.query(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
      } catch {
        // ya existe
      }
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN navConfig JSON NULL
      `);
    } catch {
      // ya existe
    }
    try {
      await this.userShops.query(`
        ALTER TABLE user_shops
          ADD COLUMN mutedNotificationTypes JSON NULL
      `);
    } catch {
      // ya existe
    }
  }

  private async loadUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !isEntityActive(user.active)) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return user;
  }

  private assertShopMember(actor: AuthUser, shopId: string) {
    if (!actor.shopIds.includes(shopId)) {
      throw new ForbiddenException('Sin acceso a este local');
    }
  }

  profileDto(user: User) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone ?? null,
      bankAlias: user.bankAlias ?? null,
      cbu: user.cbu ?? null,
      avatarUrl: user.avatarUrl ?? null,
      hasAvatar: !!user.avatarUrl,
    };
  }

  async getSelf(actor: AuthUser) {
    return this.profileDto(await this.loadUser(actor.id));
  }

  async updateSelf(actor: AuthUser, dto: UpdateProfileDto) {
    const user = await this.loadUser(actor.id);
    if (dto.fullName !== undefined) {
      const name = dto.fullName.trim();
      if (name.length < 2) throw new BadRequestException('Nombre demasiado corto');
      user.fullName = name;
    }
    if (dto.phone !== undefined) user.phone = this.emptyToNull(dto.phone);
    if (dto.bankAlias !== undefined) user.bankAlias = this.emptyToNull(dto.bankAlias);
    if (dto.cbu !== undefined) user.cbu = this.emptyToNull(dto.cbu);
    await this.users.save(user);
    return this.profileDto(user);
  }

  async uploadAvatar(actor: AuthUser, file: Express.Multer.File, targetUserId?: string) {
    const userId = targetUserId ?? actor.id;
    if (userId !== actor.id) {
      throw new ForbiddenException('Usá el endpoint de admin para subir avatar de otro usuario');
    }
    return this.saveAvatarForUser(userId, file);
  }

  async uploadAvatarAsAdmin(userId: string, file: Express.Multer.File) {
    return this.saveAvatarForUser(userId, file);
  }

  private async saveAvatarForUser(userId: string, file: Express.Multer.File) {
    const user = await this.loadUser(userId);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo requerido');
    }
    const mime = (file.mimetype || '').toLowerCase();
    if (mime && !IMAGE_MIME.has(mime) && !mime.startsWith('image/')) {
      throw new BadRequestException('La foto debe ser una imagen (PNG, JPG, WEBP…)');
    }
    if (isUploadedAvatarPath(user.avatarUrl)) {
      deleteUploadIfExists(user.avatarUrl);
    }
    const saved = saveUploadFile({
      relativeDir: `users/${userId}`,
      basename: 'avatar',
      buffer: file.buffer,
      originalName: file.originalname,
      mime: file.mimetype,
    });
    user.avatarUrl = saved.relativePath;
    await this.users.save(user);
    return this.profileDto(user);
  }

  async removeAvatar(actor: AuthUser) {
    const user = await this.loadUser(actor.id);
    if (isUploadedAvatarPath(user.avatarUrl)) {
      deleteUploadIfExists(user.avatarUrl);
    }
    user.avatarUrl = null;
    await this.users.save(user);
    return this.profileDto(user);
  }

  async fetchAvatar(
    userId: string,
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'avatarUrl', 'active'],
    });
    if (!user || !isEntityActive(user.active)) return null;
    const raw = user.avatarUrl?.trim() ?? null;
    if (!raw || !isUploadedAvatarPath(raw)) return null;
    const abs = resolveUploadPath(raw);
    if (!abs) return null;
    try {
      const buffer = readFileSync(abs);
      if (!buffer.length) return null;
      return { buffer, contentType: mimeFromPath(raw) };
    } catch {
      return null;
    }
  }

  async getShopPreferences(actor: AuthUser, shopId: string) {
    this.assertShopMember(actor, shopId);
    const shop = await this.shops.findOne({ where: { id: shopId, active: true } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const link = await this.userShops.findOne({ where: { userId: actor.id, shopId } });
    const user = await this.loadUser(actor.id);
    return {
      shopId,
      shopNavConfig: shop.navConfig ?? null,
      navConfig: link?.navConfig ?? null,
      mutedNotificationTypes: Array.isArray(link?.mutedNotificationTypes)
        ? link!.mutedNotificationTypes
        : [],
      eligibleNotifications: eligibleNotificationsPayload({
        link,
        globalRole: user.globalRole,
      }),
      usingShopMenuDefault: link?.navConfig == null,
    };
  }

  async updateShopPreferences(
    actor: AuthUser,
    shopId: string,
    dto: UpdateShopPreferencesDto,
  ) {
    this.assertShopMember(actor, shopId);
    let link = await this.userShops.findOne({ where: { userId: actor.id, shopId } });
    if (!link) {
      throw new ForbiddenException('No pertenecés a este local');
    }
    if (dto.navConfig !== undefined) {
      if (dto.navConfig == null) {
        link.navConfig = null;
      } else {
        const normalized = this.normalizeNavConfig(dto.navConfig);
        link.navConfig = this.isMeaningfulNavConfig(normalized) ? normalized : null;
      }
    }
    if (dto.mutedNotificationTypes !== undefined) {
      link.mutedNotificationTypes =
        dto.mutedNotificationTypes == null
          ? null
          : [
              ...new Set(
                dto.mutedNotificationTypes
                  .map((t) => String(t ?? '').trim())
                  .filter(Boolean),
              ),
            ];
    }
    await this.userShops.save(link);
    return this.getShopPreferences(actor, shopId);
  }

  private normalizeNavConfig(
    raw: NonNullable<Shop['navConfig']>,
  ): NonNullable<Shop['navConfig']> {
    return {
      groups: Array.isArray(raw.groups) ? raw.groups : undefined,
      itemGroup:
        raw.itemGroup && typeof raw.itemGroup === 'object' ? raw.itemGroup : undefined,
      itemOrder:
        raw.itemOrder && typeof raw.itemOrder === 'object' ? raw.itemOrder : undefined,
      hidden: Array.isArray(raw.hidden) ? raw.hidden : undefined,
      itemLabels:
        raw.itemLabels && typeof raw.itemLabels === 'object' ? raw.itemLabels : undefined,
    };
  }

  private isMeaningfulNavConfig(cfg: Shop['navConfig']): boolean {
    if (!cfg || typeof cfg !== 'object') return false;
    return !!(
      (Array.isArray(cfg.groups) && cfg.groups.length) ||
      (cfg.itemGroup && Object.keys(cfg.itemGroup).length) ||
      (cfg.itemOrder && Object.keys(cfg.itemOrder).length) ||
      (Array.isArray(cfg.hidden) && cfg.hidden.length) ||
      (cfg.itemLabels && Object.keys(cfg.itemLabels).length)
    );
  }

  private emptyToNull(v?: string | null): string | null {
    const s = (v ?? '').trim();
    return s ? s : null;
  }
}
