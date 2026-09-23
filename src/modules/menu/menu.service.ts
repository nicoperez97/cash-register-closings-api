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
  normalizeKitchenSectors,
  normalizeRemovableIngredients,
  normalizeShopMenus,
  parseMenuFile,
  ShopMenu,
  ShopMenuDoc,
  ShopMenuItem,
} from './menu-parse.util';
import { buildPricedMenuPdf } from './menu-priced-pdf';
import { isPromoInSchedule, normalizeShopPromos, type ShopPromo } from '../../common/shop-promos';

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

  /**
   * Persiste solo columnas de carta/promos con SQL puntual.
   * Evita shopsRepo.save()/update() que reescriben FKs huérfanas (salesSystemId de un dump).
   */
  private async persistShopColumns(
    shopId: string,
    patch: Partial<Pick<Shop, 'menu' | 'kitchenSectors' | 'promos'>>,
  ) {
    await this.healOrphanSalesSystemId(shopId);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.menu !== undefined) {
      sets.push('`menu` = ?');
      params.push(JSON.stringify(patch.menu));
    }
    if (patch.kitchenSectors !== undefined) {
      sets.push('`kitchenSectors` = ?');
      params.push(
        patch.kitchenSectors == null ? null : JSON.stringify(patch.kitchenSectors),
      );
    }
    if (patch.promos !== undefined) {
      sets.push('`promos` = ?');
      params.push(patch.promos == null ? null : JSON.stringify(patch.promos));
    }
    if (!sets.length) return;
    params.push(shopId);
    await this.shopsRepo.query(`UPDATE shops SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  /** Limpia salesSystemId si apunta a un sistema que no existe (post-dump). */
  private async healOrphanSalesSystemId(shopId: string) {
    await this.shopsRepo.query(
      `UPDATE shops s
       LEFT JOIN sales_systems ss ON ss.id = s.salesSystemId
       SET s.salesSystemId = NULL
       WHERE s.id = ? AND s.salesSystemId IS NOT NULL AND ss.id IS NULL`,
      [shopId],
    );
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
      kitchenSectors: normalizeKitchenSectors(shop.kitchenSectors),
    };
  }

  async getPromosAdmin(user: AuthUser, shopId: string) {
    this.shops.assertOrderingCatalogManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    return {
      slug: shop.slug,
      promos: normalizeShopPromos(shop.promos),
      menus: this.readMenus(shop).map((m) => ({
        id: m.id,
        title: m.title,
        sections: (m.sections ?? []).map((sec) => ({
          name: sec.name,
          items: (sec.items ?? [])
            .filter((it) => it.id && it.name)
            .map((it) => ({
              id: it.id!,
              name: it.name,
              price: it.price ?? null,
              available: it.available !== false,
            })),
        })),
      })),
    };
  }

  async savePromosAdmin(user: AuthUser, shopId: string, body: { promos?: ShopPromo[] } | ShopPromo[]) {
    this.shops.assertOrderingCatalogManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const raw = Array.isArray(body) ? body : body?.promos;
    shop.promos = normalizeShopPromos(raw);
    await this.persistShopColumns(shopId, { promos: shop.promos });
    return { promos: normalizeShopPromos(shop.promos) };
  }

  async saveAdmin(
    user: AuthUser,
    shopId: string,
    body: { menus?: ShopMenu[]; kitchenSectors?: Array<{ id?: string; name?: string; showEntradas?: boolean }> } | ShopMenu,
  ) {
    this.shops.assertOrderingCatalogManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const previous = this.readMenus(shop);
    const previousFiles = new Set(
      previous.map((m) => m.sourceFile).filter((p): p is string => !!p),
    );
    const previousImages = this.collectItemImages(previous);
    const asStore = body && typeof body === 'object' && Array.isArray((body as { menus?: ShopMenu[] }).menus)
      ? body
      : { menus: [body as ShopMenu] };
    const menus = normalizeShopMenus(asStore).map((m) => this.withSafeSource(m, shopId));
    shop.menu = { menus };
    const patch: Partial<Pick<Shop, 'menu' | 'kitchenSectors'>> = { menu: shop.menu };
    if (
      body &&
      typeof body === 'object' &&
      Array.isArray((body as { kitchenSectors?: unknown }).kitchenSectors)
    ) {
      shop.kitchenSectors = normalizeKitchenSectors(
        (body as { kitchenSectors: unknown }).kitchenSectors,
      );
      patch.kitchenSectors = shop.kitchenSectors;
    }
    await this.persistShopColumns(shopId, patch);
    const keepFiles = new Set(menus.map((m) => m.sourceFile).filter((p): p is string => !!p));
    for (const file of previousFiles) {
      if (!keepFiles.has(file)) deleteUploadIfExists(file);
    }
    const keepImages = this.collectItemImages(menus);
    for (const file of previousImages) {
      if (!keepImages.has(file)) deleteUploadIfExists(file);
    }
    return {
      enabled: !!shop.menuEnabled,
      slug: shop.slug,
      menus,
      kitchenSectors: normalizeKitchenSectors(shop.kitchenSectors),
    };
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
    await this.persistShopColumns(shopId, { menu: shop.menu });
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
      priceSlots: [],
    };
    shop.menu = { menus };
    await this.persistShopColumns(shopId, { menu: shop.menu });
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
    await this.persistShopColumns(shopId, { menu: shop.menu });
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
    await this.persistShopColumns(shopId, { menu: shop.menu });
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
    const promos = normalizeShopPromos(shop.promos)
      .filter(
        (p) =>
          p.available &&
          p.showOnPublicMenu &&
          isPromoInSchedule(p, new Date(), shop.timezone),
      )
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        fixedPrice: p.fixedPrice,
        items: p.items,
        specialName: p.specialName ?? null,
      }));
    return {
      shop: this.publicShop(shop),
      menus: published.map((m) => ({
        slug: m.slug,
        title: m.title || 'Carta',
      })),
      menu: this.publicMenuPayload(selected),
      promos,
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

  private itemsById(menu: ShopMenuDoc): Map<string, ShopMenuItem> {
    const map = new Map<string, ShopMenuItem>();
    for (const sec of menu.sections ?? []) {
      for (const it of sec.items ?? []) {
        const id = String(it.id ?? '').trim();
        if (id) map.set(id, it);
      }
    }
    return map;
  }

  async adminSourceFile(user: AuthUser, shopId: string, menuId: string) {
    this.shops.assertOrderingCatalogManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const menu = this.readMenus(shop)
      .map((m) => this.withSafeSource(m, shopId))
      .find((m) => m.id === menuId);
    if (!menu) throw new NotFoundException('Carta no encontrada');
    const path = this.sanitizeSourceFile(menu.sourceFile, shopId);
    const abs = resolveUploadPath(path);
    if (!abs) throw new NotFoundException('Archivo no encontrado');
    const fileName = menu.sourceFileName || `carta${extname(abs) || '.pdf'}`;
    const mime =
      menu.sourceMime ||
      (extname(abs).toLowerCase() === '.pdf' ? 'application/pdf' : 'application/octet-stream');
    return {
      stream: new StreamableFile(createReadStream(abs)),
      fileName,
      mime,
    };
  }

  private async buildPricedPdfForMenu(shopId: string, menu: ShopMenuDoc) {
    const path = this.sanitizeSourceFile(menu.sourceFile, shopId);
    const abs = resolveUploadPath(path);
    if (!abs) throw new BadRequestException('Esta carta no tiene archivo físico PDF');
    const kind = this.sourceKind(menu.sourceMime, menu.sourceFileName || menu.sourceFile);
    if (kind !== 'pdf') {
      throw new BadRequestException('Los precios sobre carta solo aplican a un PDF físico');
    }
    const slots = menu.priceSlots ?? [];
    if (!slots.length) {
      throw new BadRequestException('Marcá al menos una caja de precio en la carta física');
    }
    const bytes = readFileSync(abs);
    const pdf = await buildPricedMenuPdf({
      sourceBytes: bytes,
      slots,
      itemsById: this.itemsById(menu),
    });
    const base = String(menu.sourceFileName || menu.title || 'carta')
      .replace(/\.pdf$/i, '')
      .replace(/[^\w\-áéíóúüñÁÉÍÓÚÜÑ .]+/g, '')
      .trim()
      .slice(0, 80);
    return {
      bytes: pdf,
      fileName: `${base || 'carta'}-precios.pdf`,
    };
  }

  /** PDF físico con precios vivos (admin). */
  async adminPricedPdf(user: AuthUser, shopId: string, menuId: string) {
    this.shops.assertOrderingCatalogManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const menus = this.readMenus(shop).map((m) => this.withSafeSource(m, shopId));
    const menu = menus.find((m) => m.id === menuId);
    if (!menu) throw new NotFoundException('Carta no encontrada');
    return this.buildPricedPdfForMenu(shopId, menu);
  }

  /** PDF físico con precios vivos (público). */
  async publicPricedPdf(slug: string, menuSlug: string) {
    const shop = await this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase());
    if (!shop) throw new NotFoundException('Archivo no encontrado');
    const selected = this.resolvePublished(shop, menuSlug);
    return this.buildPricedPdfForMenu(shop.id, this.withSafeSource(selected, shop.id));
  }
}
