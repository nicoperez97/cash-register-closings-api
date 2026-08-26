import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shortage } from '../../entities/shortage.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { NotificationType, ShortageLevel } from '../../common/enums';
import { ShopsService } from '../shops/shops.service';
import { NotificationsService } from '../notifications/notifications.service';

const LEVEL_LABELS: Record<ShortageLevel, string> = {
  [ShortageLevel.NONE]: 'Nada',
  [ShortageLevel.LOW]: 'Poco',
  [ShortageLevel.NORMAL]: 'Normal',
  [ShortageLevel.HIGH]: 'Mucho',
};

const CRITICAL_LEVELS = new Set<ShortageLevel>([
  ShortageLevel.NONE,
  ShortageLevel.LOW,
]);

function isCritical(level: ShortageLevel): boolean {
  return CRITICAL_LEVELS.has(level);
}

function levelLabel(level: ShortageLevel): string {
  return LEVEL_LABELS[level] ?? String(level);
}

@Injectable()
export class ShortagesService implements OnModuleInit {
  private readonly logger = new Logger(ShortagesService.name);

  constructor(
    @InjectRepository(Shortage)
    private readonly shortages: Repository<Shortage>,
    @InjectRepository(UserShop)
    private readonly userShops: Repository<UserShop>,
    private readonly shops: ShopsService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    try {
      await this.shortages.query(`
        CREATE TABLE IF NOT EXISTS shortages (
          id CHAR(36) NOT NULL PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          name VARCHAR(200) NOT NULL,
          level ENUM('NONE', 'LOW', 'NORMAL', 'HIGH') NOT NULL DEFAULT 'NORMAL',
          notes VARCHAR(500) NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX idx_shortages_shop (shopId)
        )
      `);
    } catch {
      // ya existe
    }
  }

  private toDto(row: Shortage) {
    return {
      id: row.id,
      shopId: row.shopId,
      name: row.name,
      level: row.level,
      levelLabel: levelLabel(row.level),
      notes: row.notes ?? null,
      active: isEntityActive(row.active),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt ?? null,
    };
  }

  async list(user: AuthUser, shopId: string, includeInactive = false) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.shortages.find({
      where: { shopId },
      order: { name: 'ASC' },
    });
    const filtered = includeInactive
      ? rows
      : rows.filter((r) => isEntityActive(r.active));
    return filtered.map((r) => this.toDto(r));
  }

  async one(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.shortages.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Faltante no encontrado');
    return this.toDto(row);
  }

  async create(
    user: AuthUser,
    shopId: string,
    dto: {
      name: string;
      level: ShortageLevel;
      notes?: string | null;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Indicá el nombre del faltante');
    if (!Object.values(ShortageLevel).includes(dto.level)) {
      throw new BadRequestException('Nivel inválido');
    }

    const row = await this.shortages.save(
      this.shortages.create({
        shopId,
        name,
        level: dto.level,
        notes: dto.notes?.trim() || null,
        active: dto.active ?? true,
      }),
    );

    if (isCritical(row.level)) {
      void this.notifyShortage(
        user,
        shopId,
        row,
        NotificationType.SHORTAGE_CREATED,
        'Faltante crítico cargado',
        `Se cargó «${row.name}» con nivel ${levelLabel(row.level)}.`,
      ).catch((err) => {
        this.logger.warn(
          `No se pudo notificar faltante creado: ${(err as Error)?.message ?? err}`,
        );
      });
    }

    return this.toDto(row);
  }

  async update(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: {
      name?: string;
      level?: ShortageLevel;
      notes?: string | null;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.shortages.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Faltante no encontrado');

    const previousLevel = row.level;

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Indicá el nombre del faltante');
      row.name = name;
    }
    if (dto.level !== undefined) {
      if (!Object.values(ShortageLevel).includes(dto.level)) {
        throw new BadRequestException('Nivel inválido');
      }
      row.level = dto.level;
    }
    if (dto.notes !== undefined) row.notes = dto.notes?.trim() || null;
    if (dto.active !== undefined) row.active = dto.active;

    await this.shortages.save(row);

    if (dto.level !== undefined && dto.level !== previousLevel) {
      const wasCritical = isCritical(previousLevel);
      const nowCritical = isCritical(row.level);

      if (!wasCritical && nowCritical) {
        void this.notifyShortage(
          user,
          shopId,
          row,
          NotificationType.SHORTAGE_LEVEL_LOW,
          'Faltante bajó a crítico',
          `«${row.name}» pasó de ${levelLabel(previousLevel)} a ${levelLabel(row.level)}.`,
        ).catch((err) => {
          this.logger.warn(
            `No se pudo notificar nivel bajo: ${(err as Error)?.message ?? err}`,
          );
        });
      } else if (wasCritical && !nowCritical) {
        void this.notifyShortage(
          user,
          shopId,
          row,
          NotificationType.SHORTAGE_RESOLVED,
          'Faltante resuelto',
          `«${row.name}» pasó de ${levelLabel(previousLevel)} a ${levelLabel(row.level)}.`,
        ).catch((err) => {
          this.logger.warn(
            `No se pudo notificar resolución: ${(err as Error)?.message ?? err}`,
          );
        });
      }
    }

    return this.toDto(row);
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.shortages.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Faltante no encontrado');
    row.active = false;
    await this.shortages.save(row);
    return { ok: true };
  }

  /** Destinatarios: administradores de faltantes del local (flag isShortageAdmin). */
  private async resolveRecipientIds(
    shopId: string,
    actorId: string,
  ): Promise<string[]> {
    const links = await this.userShops.find({ where: { shopId } });
    const recipientIds = [
      ...new Set(
        links.filter((l) => !!l.isShortageAdmin).map((l) => l.userId),
      ),
    ];
    return recipientIds.filter((id) => id !== actorId);
  }

  private async notifyShortage(
    actor: AuthUser,
    shopId: string,
    row: Shortage,
    type: NotificationType,
    title: string,
    body: string,
  ) {
    const recipientIds = await this.resolveRecipientIds(shopId, actor.id);
    if (!recipientIds.length) return;

    await this.notifications.createMany(
      recipientIds.map((userId) => ({
        userId,
        shopId,
        type,
        title,
        body,
        targetId: row.id,
      })),
    );
  }
}
