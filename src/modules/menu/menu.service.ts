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
import { GeminiDocumentService } from '../ai/gemini-document.service';
import {
  emptyShopMenu,
  menuHasItems,
  normalizeRemovableIngredients,
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
    private readonly gemini: GeminiDocumentService,
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

  private sanitizeItemImage(raw: string | null | undefined, shopId: string): string | null {
    const path = String(raw ?? '')
      .trim()
      .replace(/\\/g, '/');
    if (!path || path.includes('..')) return null;
    if (!path.startsWith(`menus/${shopId}/items/`)) return null;
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
      sections: (menu.sections ?? []).map((sec) => ({
        ...sec,
        items: (sec.items ?? []).map((it) => ({
          ...it,
          imageUrl: this.sanitizeItemImage(it.imageUrl, shopId),
        })),
      })),
    };
  }

  private collectItemImages(menus: ShopMenuDoc[]): Set<string> {
    const out = new Set<string>();
    for (const m of menus) {
      for (const sec of m.sections ?? []) {
        for (const it of sec.items ?? []) {
          if (it.imageUrl) out.add(it.imageUrl);
        }
      }
    }
    return out;
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
    this.shops.assertOrderingCatalogManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    return {
      enabled: !!shop.menuEnabled,
      slug: shop.slug,
      menus: this.readMenus(shop).map((m) => this.withSafeSource(m, shopId)),
    };
  }

  async saveAdmin(user: AuthUser, shopId: string, body: { menus?: ShopMenu[] } | ShopMenu) {
    this.shops.assertOrderingCatalogManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const previous = this.readMenus(shop);
    const previousFiles = new Set(
      previous.map((m) => m.sourceFile).filter((p): p is string => !!p),
    );
    const previousImages = this.collectItemImages(previous);
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
    const keepImages = this.collectItemImages(menus);
    for (const file of previousImages) {
      if (!keepImages.has(file)) deleteUploadIfExists(file);
    }
    return { enabled: !!shop.menuEnabled, slug: shop.slug, menus };
  }

  async parseUpload(user: AuthUser, shopId: string, file?: Express.Multer.File) {
    this.shops.assertOrderingCatalogManage(user, shopId);
    let buffer = file?.buffer;
    if (!buffer?.length && (file as Express.Multer.File & { path?: string })?.path) {
      buffer = readFileSync((file as Express.Multer.File & { path: string }).path);
    }
    if (!file || !buffer?.length) {
      throw new BadRequestException('Subí un PDF, una imagen o un .txt de la carta');
    }
    const uploadFile = { ...file, buffer };
    try {
      let menuPayload: ShopMenu | null = null;
      let rawText = '';
      let engine: 'classic' | 'gemini' = 'classic';
      let geminiWarning: string | null = null;

      if (this.gemini.isEnabled()) {
        const ai = await this.gemini.parseMenu(uploadFile);
        if (ai.ok && menuHasItems(ai.data.menu)) {
          menuPayload = ai.data.menu;
          rawText = ai.data.rawText;
          engine = 'gemini';
        } else if (!ai.ok) {
          geminiWarning = ai.message;
        } else {
          geminiWarning = 'Gemini no encontró ítems claros. Se usó el parseo local.';
        }
      } else {
        geminiWarning = 'Gemini no está configurado. Se usó el parseo local.';
      }

      if (!menuPayload) {
        const classic = await parseMenuFile(uploadFile);
        menuPayload = classic.menu;
        rawText = classic.rawText;
        engine = 'classic';
      }

      const menu = emptyShopMenu(menuPayload);
      const ingredientsCount = (menu.sections ?? []).reduce(
        (n, s) =>
          n +
          (s.items ?? []).filter((it) => (it.removableIngredients?.length ?? 0) > 0).length,
        0,
      );
      return {
        menu,
        rawText,
        fileName: file.originalname,
        engine,
        geminiWarning,
        ingredientsCount,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo leer el archivo';
      throw new BadRequestException(msg);
    }
  }

  async analyzeIngredients(
    user: AuthUser,
    shopId: string,
    body?: {
      items?: Array<{ id?: string; name?: string; description?: string | null }>;
    },
  ) {
    this.shops.assertOrderingCatalogManage(user, shopId);
    if (!this.gemini.isEnabled()) {
      throw new BadRequestException('Gemini no está configurado (falta GEMINI_API_KEY).');
    }
    const items = (body?.items ?? [])
      .map((it) => ({
        id: String(it?.id ?? '').trim(),
        name: String(it?.name ?? '').trim(),
        description: String(it?.description ?? '').trim() || null,
      }))
      .filter((it) => it.id && it.name);
    if (!items.length) {
      throw new BadRequestException('No hay ítems para analizar');
    }
    const ai = await this.gemini.suggestRemovableIngredients(items);
    if (!ai.ok) {
      throw new BadRequestException(ai.message || 'No se pudieron detectar ingredientes');
    }
    const suggestions = ai.data.map((row) => ({
      id: row.id,
      removableIngredients: normalizeRemovableIngredients(row.removableIngredients),
    }));
    const withIngredients = suggestions.filter((s) => s.removableIngredients.length > 0).length;
    return {
      items: suggestions,
      analyzed: suggestions.length,
      withIngredients,
    };
  }

  async attachSourceFile(user: AuthUser, shopId: string, menuId: string, file?: Express.Multer.File) {
    this.shops.assertOrderingCatalogManage(user, shopId);
    let buffer = file?.buffer;
    if (!buffer?.length && (file as Express.Multer.File & { path?: string })?.path) {
      buffer = readFileSync((file as Express.Multer.File & { path: string }).path);
    }
    if (!file || !buffer?.length) {
      throw new BadRequestException('Subí el PDF o la imagen de la carta física');
    }
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const menus = this.readMenus(shop);
    const idx = menus.findIndex((m) => m.id === menuId);
    if (idx < 0) throw new NotFoundException('Carta no encontrada. Guardá la carta primero.');
    const current = menus[idx];
    if (current.sourceFile) deleteUploadIfExists(current.sourceFile);
    const saved = saveUploadFile({
      relativeDir: `menus/${shopId}`,
      basename: `src-${current.id}`,
      buffer,
      originalName: file.originalname,
      mime: file.mimetype,
    });
    menus[idx] = {
      ...current,
      sourceFile: saved.relativePath,
      sourceFileName: String(file.originalname || saved.fileName).slice(0, 120),
      sourceMime: String(file.mimetype || '').slice(0, 80) || null,
    };
    shop.menu = { menus };
    await this.shopsRepo.save(shop);
    return {
      enabled: !!shop.menuEnabled,
      slug: shop.slug,
      menus: menus.map((m) => this.withSafeSource(m, shopId)),
      attached: {
        sourceFile: menus[idx].sourceFile,
        sourceFileName: menus[idx].sourceFileName,
        sourceMime: menus[idx].sourceMime,
      },
    };
  }

  async clearSourceFile(user: AuthUser, shopId: string, menuId: string) {
    this.shops.assertOrderingCatalogManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const menus = this.readMenus(shop);
    const idx = menus.findIndex((m) => m.id === menuId);
    if (idx < 0) throw new NotFoundException('Carta no encontrada');
    if (menus[idx].sourceFile) deleteUploadIfExists(menus[idx].sourceFile);
    menus[idx] = {
      ...menus[idx],
      sourceFile: null,
      sourceFileName: null,
      sourceMime: null,
    };
    shop.menu = { menus };
    await this.shopsRepo.save(shop);
    return {
      enabled: !!shop.menuEnabled,
      slug: shop.slug,
      menus: menus.map((m) => this.withSafeSource(m, shopId)),
    };
  }

  async uploadItemImage(
    user: AuthUser,
    shopId: string,
    itemId: string,
    file?: Express.Multer.File,
  ) {
    this.shops.assertOrderingCatalogManage(user, shopId);
    let buffer = file?.buffer;
    if (!buffer?.length && (file as Express.Multer.File & { path?: string })?.path) {
      buffer = readFileSync((file as Express.Multer.File & { path: string }).path);
    }
    if (!file || !buffer?.length) {
      throw new BadRequestException('Subí una imagen del ítem (JPG, PNG o WebP)');
    }
    const mime = String(file.mimetype || '').toLowerCase();
    if (!mime.startsWith('image/')) {
      throw new BadRequestException('El archivo tiene que ser una imagen');
    }
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const wanted = String(itemId ?? '').trim();
    if (!wanted) throw new BadRequestException('Ítem inválido');
    const menus = this.readMenus(shop);
    let found: { menuIdx: number; secIdx: number; itemIdx: number } | null = null;
    for (let mi = 0; mi < menus.length; mi++) {
      const sections = menus[mi].sections ?? [];
      for (let si = 0; si < sections.length; si++) {
        const items = sections[si].items ?? [];
        for (let ii = 0; ii < items.length; ii++) {
          if (String(items[ii].id ?? '').trim() === wanted) {
            found = { menuIdx: mi, secIdx: si, itemIdx: ii };
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }
    if (!found) throw new NotFoundException('Ítem no encontrado. Guardá la carta primero.');
    const current = menus[found.menuIdx].sections[found.secIdx].items[found.itemIdx];
    if (current.imageUrl) deleteUploadIfExists(current.imageUrl);
    const saved = saveUploadFile({
      relativeDir: `menus/${shopId}/items`,
      basename: wanted,
      buffer,
      originalName: file.originalname,
      mime: file.mimetype,
    });
    menus[found.menuIdx].sections[found.secIdx].items[found.itemIdx] = {
      ...current,
      imageUrl: saved.relativePath,
    };
    shop.menu = { menus };
    await this.shopsRepo.save(shop);
    return {
      enabled: !!shop.menuEnabled,
      slug: shop.slug,
      menus: menus.map((m) => this.withSafeSource(m, shopId)),
      imageUrl: saved.relativePath,
    };
  }

  async clearItemImage(user: AuthUser, shopId: string, itemId: string) {
    this.shops.assertOrderingCatalogManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const wanted = String(itemId ?? '').trim();
    const menus = this.readMenus(shop);
    let cleared = false;
    for (const menu of menus) {
      for (const sec of menu.sections ?? []) {
        for (const it of sec.items ?? []) {
          if (String(it.id ?? '').trim() !== wanted) continue;
          if (it.imageUrl) deleteUploadIfExists(it.imageUrl);
          it.imageUrl = null;
          cleared = true;
        }
      }
    }
    if (!cleared) throw new NotFoundException('Ítem no encontrado');
    shop.menu = { menus };
    await this.shopsRepo.save(shop);
    return {
      enabled: !!shop.menuEnabled,
      slug: shop.slug,
      menus: menus.map((m) => this.withSafeSource(m, shopId)),
    };
  }

  async publicItemImage(slug: string, itemId: string) {
    const shop = await this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase());
    if (!shop) throw new NotFoundException('Imagen no encontrada');
    const wanted = String(itemId ?? '').trim();
    for (const menu of this.readMenus(shop)) {
      for (const sec of menu.sections ?? []) {
        for (const it of sec.items ?? []) {
          if (String(it.id ?? '').trim() !== wanted) continue;
          const path = this.sanitizeItemImage(it.imageUrl, shop.id);
          const abs = resolveUploadPath(path);
          if (!abs) throw new NotFoundException('Imagen no encontrada');
          const mime =
            extname(abs).toLowerCase() === '.png'
              ? 'image/png'
              : extname(abs).toLowerCase() === '.webp'
                ? 'image/webp'
                : extname(abs).toLowerCase() === '.gif'
                  ? 'image/gif'
                  : 'image/jpeg';
          return {
            stream: new StreamableFile(createReadStream(abs)),
            mime,
            fileName: `item${extname(abs) || '.jpg'}`,
          };
        }
      }
    }
    throw new NotFoundException('Imagen no encontrada');
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
