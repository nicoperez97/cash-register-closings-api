import {
  BadRequestException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createReadStream, readFileSync } from 'fs';
import { extname } from 'path';
import { Repository } from 'typeorm';
import { Shop } from '../../entities/shop.entity';
import { AuthUser } from '../../common/decorators';
import { deleteUploadIfExists, resolveUploadPath, saveUploadFile } from '../../common/uploads';
import { ShopsService } from '../shops/shops.service';
import {
  emptyShopMenu,
  menuHasItems,
  normalizeShopMenus,
  parseMenuFile,
  ShopMenu,
  ShopMenuDoc,
} from './menu-parse.util';

@Injectable()
export class MenuService {
  constructor(
    @InjectRepository(Shop) private readonly shopsRepo: Repository<Shop>,
    private readonly shops: ShopsService,
  ) {}

  private readMenus(shop: Shop): ShopMenuDoc[] {
    return normalizeShopMenus(shop.menu);
  }

  private sanitizeSourceFile(raw: string | null | undefined, shopId: string): string | null {
    const path = String(raw ?? '')
      .trim()
      .replace(/\\/g, '/');
    if (!path || path.includes('..')) return null;
    if (!path.startsWith(`menus/${shopId}/`)) return null;
    if (!resolveUploadPath(path)) return null;
    return path;
  }

  private withSafeSource(menu: ShopMenuDoc, shopId: string): ShopMenuDoc {
    const sourceFile = this.sanitizeSourceFile(menu.sourceFile, shopId);
    return {
      ...menu,
      sourceFile,
      sourceFileName: sourceFile ? menu.sourceFileName ?? null : null,
      sourceMime: sourceFile ? menu.sourceMime ?? null : null,
    };
  }

  private sourceKind(mime?: string | null, fileName?: string | null): 'pdf' | 'image' | 'other' {
    const m = String(mime ?? '').toLowerCase();
    if (m === 'application/pdf' || m === 'application/x-pdf') return 'pdf';
    if (m.startsWith('image/')) return 'image';
    const name = String(fileName ?? '').toLowerCase();
    if (name.endsWith('.pdf')) return 'pdf';
    if (/\.(jpe?g|png|webp|gif)$/i.test(name)) return 'image';
    return 'other';
  }

  private publicMenuPayload(menu: ShopMenuDoc) {
    const abs = resolveUploadPath(menu.sourceFile);
    return {
      id: menu.id,
      slug: menu.slug,
      title: menu.title,
      note: menu.note,
      sections: menu.sections,
      hasSourceFile: !!abs,
      sourceFileName: abs ? menu.sourceFileName ?? null : null,
      sourceKind: abs ? this.sourceKind(menu.sourceMime, menu.sourceFileName || menu.sourceFile) : null,
    };
  }

  async getAdmin(user: AuthUser, shopId: string) {
    this.shops.assertShopManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    return {
      enabled: !!shop.menuEnabled,
      slug: shop.slug,
      menus: this.readMenus(shop).map((m) => this.withSafeSource(m, shopId)),
    };
  }

  async saveAdmin(user: AuthUser, shopId: string, body: { menus?: ShopMenu[] } | ShopMenu) {
    this.shops.assertShopManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const previous = this.readMenus(shop);
    const previousFiles = new Set(
      previous.map((m) => m.sourceFile).filter((p): p is string => !!p),
    );
    const menus = normalizeShopMenus(
      body && typeof body === 'object' && Array.isArray((body as { menus?: ShopMenu[] }).menus)
        ? body
        : { menus: [body as ShopMenu] },
    ).map((m) => this.withSafeSource(m, shopId));
    shop.menu = { menus };
    await this.shopsRepo.save(shop);
    const keepFiles = new Set(menus.map((m) => m.sourceFile).filter((p): p is string => !!p));
    for (const file of previousFiles) {
      if (!keepFiles.has(file)) deleteUploadIfExists(file);
    }
    return { enabled: !!shop.menuEnabled, slug: shop.slug, menus };
  }

  async parseUpload(user: AuthUser, shopId: string, file?: Express.Multer.File) {
    this.shops.assertShopManage(user, shopId);
    let buffer = file?.buffer;
    if (!buffer?.length && (file as Express.Multer.File & { path?: string })?.path) {
      buffer = readFileSync((file as Express.Multer.File & { path: string }).path);
    }
    if (!file || !buffer?.length) {
      throw new BadRequestException('Subí un PDF, una imagen o un .txt de la carta');
    }
    const uploadFile = { ...file, buffer };
    try {
      const parsed = await parseMenuFile(uploadFile);
      const menu = emptyShopMenu(parsed.menu);
      const saved = saveUploadFile({
        relativeDir: `menus/${shopId}`,
        basename: `src-${menu.id}`,
        buffer,
        originalName: file.originalname,
        mime: file.mimetype,
      });
      menu.sourceFile = saved.relativePath;
      menu.sourceFileName = String(file.originalname || saved.fileName).slice(0, 120);
      menu.sourceMime = String(file.mimetype || '').slice(0, 80) || null;
      return {
        menu,
        rawText: parsed.rawText,
        fileName: file.originalname,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo leer el archivo';
      throw new BadRequestException(msg);
    }
  }

  private publicShop(shop: Shop) {
    return {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      logoUrl: shop.logoUrl ?? null,
      accentColor: shop.accentColor ?? null,
      phone: shop.phone ?? null,
      instagramHandle: shop.instagramHandle ?? null,
    };
  }

  private resolvePublished(shop: Shop, menuSlug?: string): ShopMenuDoc {
    if (!shop.menuEnabled) {
      throw new NotFoundException('Carta no disponible en este local');
    }
    const published = this.readMenus(shop).filter(menuHasItems);
    if (!published.length) {
      throw new NotFoundException('Carta no disponible en este local');
    }
    const wanted = String(menuSlug ?? '').trim().toLowerCase();
    const selected = wanted ? published.find((m) => m.slug === wanted) : published[0];
    if (!selected) throw new NotFoundException('Carta no disponible en este local');
    return selected;
  }

  async publicMenu(slug: string, menuSlug?: string) {
    const shop = await this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase());
    if (!shop) throw new NotFoundException('Carta no disponible en este local');
    const selected = this.resolvePublished(shop, menuSlug);
    const published = this.readMenus(shop).filter(menuHasItems);
    return {
      shop: this.publicShop(shop),
      menus: published.map((m) => ({
        slug: m.slug,
        title: m.title || 'Carta',
      })),
      menu: this.publicMenuPayload(selected),
    };
  }

  async publicMenuFile(slug: string, menuSlug: string) {
    const shop = await this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase());
    if (!shop) throw new NotFoundException('Archivo no encontrado');
    const selected = this.resolvePublished(shop, menuSlug);
    const path = this.sanitizeSourceFile(selected.sourceFile, shop.id);
    const abs = resolveUploadPath(path);
    if (!abs) throw new NotFoundException('Archivo no encontrado');
    const fileName = selected.sourceFileName || `carta${extname(abs) || '.pdf'}`;
    const mime =
      selected.sourceMime ||
      (extname(abs).toLowerCase() === '.pdf'
        ? 'application/pdf'
        : /\.(jpe?g)$/i.test(abs)
          ? 'image/jpeg'
          : /\.png$/i.test(abs)
            ? 'image/png'
            : /\.webp$/i.test(abs)
              ? 'image/webp'
              : 'application/octet-stream');
    return {
      stream: new StreamableFile(createReadStream(abs)),
      fileName,
      mime,
    };
  }
}
