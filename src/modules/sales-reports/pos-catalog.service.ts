import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../../common/decorators';
import { PosCategory } from '../../entities/pos-category.entity';
import { PosSubcategory } from '../../entities/pos-subcategory.entity';
import { PosProduct } from '../../entities/pos-product.entity';
import { PosSaleTicketLine } from '../../entities/pos-sale-ticket-line.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopsService } from '../shops/shops.service';
import { GeminiDocumentService } from '../ai/gemini-document.service';
import {
  SEED_CATEGORIES,
  SEED_SUBCATEGORIES,
  SeedProduct,
  allSeedProducts,
  guessByCodeRange,
  guessWineVarietyFromName,
  looksLikeWineWithoutVariety,
  normProductCode,
  normProductName,
} from './pos-catalog.seed';

export type FlatMenuItem = {
  menuItemId: string;
  name: string;
  menuTitle: string;
  sectionName: string;
};

@Injectable()
export class PosCatalogService implements OnModuleInit {
  constructor(
    @InjectRepository(PosCategory) private readonly categories: Repository<PosCategory>,
    @InjectRepository(PosSubcategory)
    private readonly subcategories: Repository<PosSubcategory>,
    @InjectRepository(PosProduct) private readonly products: Repository<PosProduct>,
    @InjectRepository(PosSaleTicketLine)
    private readonly lines: Repository<PosSaleTicketLine>,
    @InjectRepository(Shop) private readonly shopRepo: Repository<Shop>,
    private readonly shops: ShopsService,
    private readonly gemini: GeminiDocumentService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.products.query(`
        ALTER TABLE pos_products
          ADD COLUMN menuItemId VARCHAR(36) NULL
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.products.query(`
        CREATE INDEX idx_pos_products_shop_menu_item ON pos_products (shopId, menuItemId)
      `);
    } catch {
      // índice ya existe
    }
  }

  flattenMenuItems(menu: Shop['menu'] | null | undefined): FlatMenuItem[] {
    if (!menu || typeof menu !== 'object') return [];
    const out: FlatMenuItem[] = [];
    const pushSections = (
      sections: Array<{ name?: string; items?: Array<{ id?: string; name?: string }> }> | undefined,
      menuTitle: string,
    ) => {
      for (const sec of sections ?? []) {
        const sectionName = String(sec?.name ?? '').trim() || 'Sin sección';
        for (const it of sec?.items ?? []) {
          const id = String(it?.id ?? '').trim();
          const name = String(it?.name ?? '').trim();
          if (!id || !name) continue;
          out.push({ menuItemId: id, name, menuTitle, sectionName });
        }
      }
    };
    if (Array.isArray(menu.menus) && menu.menus.length) {
      for (const m of menu.menus) {
        pushSections(m.sections, String(m.title ?? m.slug ?? 'Carta').trim() || 'Carta');
      }
    } else {
      pushSections(menu.sections, String(menu.title ?? 'Carta').trim() || 'Carta');
    }
    return out;
  }

  async listMenuItems(user: AuthUser, shopId: string): Promise<FlatMenuItem[]> {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shopRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    return this.flattenMenuItems(shop.menu);
  }

  private normalizeName(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private localNameMatches(
    posProducts: Array<{ productCode: string; productName: string | null }>,
    menuItems: FlatMenuItem[],
  ): Array<{
    productCode: string;
    menuItemId: string;
    confidence: number;
    reason: string;
  }> {
    const usedMenu = new Set<string>();
    const out: Array<{
      productCode: string;
      menuItemId: string;
      confidence: number;
      reason: string;
    }> = [];
    const menuByNorm = new Map<string, FlatMenuItem[]>();
    for (const m of menuItems) {
      const key = this.normalizeName(m.name);
      if (!key) continue;
      const arr = menuByNorm.get(key) ?? [];
      arr.push(m);
      menuByNorm.set(key, arr);
    }
    for (const p of posProducts) {
      const key = this.normalizeName(p.productName ?? '');
      if (!key) continue;
      const candidates = menuByNorm.get(key) ?? [];
      const hit = candidates.find((c) => !usedMenu.has(c.menuItemId));
      if (!hit) continue;
      usedMenu.add(hit.menuItemId);
      out.push({
        productCode: p.productCode,
        menuItemId: hit.menuItemId,
        confidence: 0.85,
        reason: 'Nombre igual (normalizado)',
      });
    }
    return out;
  }

  async suggestMenuLinks(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shopRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const menuItems = this.flattenMenuItems(shop.menu);
    const products = await this.products.find({
      where: { shopId, active: true },
      order: { productName: 'ASC' },
    });
    const posList = products.map((p) => ({
      productCode: p.productCode,
      productName: p.productName ?? null,
      currentMenuItemId: p.menuItemId ?? null,
    }));

    let suggestions: Array<{
      productCode: string;
      menuItemId: string;
      confidence: number;
      reason: string;
    }> = [];
    let source: 'gemini' | 'local' = 'local';
    let warnings: string[] = [];

    const gemini = await this.gemini.suggestPosMenuLinks({
      posProducts: posList.map((p) => ({
        productCode: p.productCode,
        productName: p.productName,
      })),
      menuItems: menuItems.map((m) => ({
        menuItemId: m.menuItemId,
        name: m.name,
        menuTitle: m.menuTitle,
        sectionName: m.sectionName,
      })),
    });
    if (gemini.ok) {
      source = 'gemini';
      suggestions = gemini.data.suggestions;
      warnings = gemini.data.warnings;
    } else {
      suggestions = this.localNameMatches(
        posList.map((p) => ({ productCode: p.productCode, productName: p.productName })),
        menuItems,
      );
      if (gemini.reason !== 'disabled') {
        warnings = [gemini.message, ...warnings].filter(Boolean).slice(0, 4);
      }
    }

    const menuIds = new Set(menuItems.map((m) => m.menuItemId));
    const codeSet = new Set(posList.map((p) => p.productCode));
    suggestions = suggestions.filter(
      (s) => codeSet.has(s.productCode) && menuIds.has(s.menuItemId),
    );

    return {
      products: posList,
      menuItems,
      suggestions,
      source,
      warnings,
    };
  }

  async commitMenuLinks(
    user: AuthUser,
    shopId: string,
    links: Array<{ productId: string; menuItemId: string | null }>,
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (!Array.isArray(links) || !links.length) {
      throw new BadRequestException('links es obligatorio');
    }
    const shop = await this.shopRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const validMenu = new Set(this.flattenMenuItems(shop.menu).map((m) => m.menuItemId));
    let updated = 0;
    for (const link of links) {
      const productId = String(link.productId ?? '').trim();
      if (!productId) continue;
      const row = await this.products.findOne({ where: { id: productId, shopId } });
      if (!row) continue;
      const menuItemId =
        link.menuItemId == null || link.menuItemId === ''
          ? null
          : String(link.menuItemId).trim();
      if (menuItemId && !validMenu.has(menuItemId)) {
        throw new BadRequestException(`Ítem de carta inválido: ${menuItemId}`);
      }
      row.menuItemId = menuItemId;
      await this.products.save(row);
      updated += 1;
    }
    return { updated };
  }

  // ─── Categories ─────────────────────────────────────────────

  async listCategories(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.categories.find({
      where: { shopId, active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return rows.map((c) => this.toCategoryDto(c));
  }

  async createCategory(
    user: AuthUser,
    shopId: string,
    dto: { name: string; sortOrder?: number; notes?: string | null },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Nombre obligatorio');
    const exists = await this.categories.findOne({ where: { shopId, name } });
    if (exists?.active) throw new BadRequestException('Ya existe ese rubro');
    const row =
      exists ??
      this.categories.create({
        shopId,
        name,
        sortOrder: 0,
        active: true,
      });
    row.name = name;
    row.sortOrder = dto.sortOrder ?? row.sortOrder ?? 0;
    row.notes = dto.notes?.trim() || null;
    row.active = true;
    row.deletedAt = undefined;
    return this.toCategoryDto(await this.categories.save(row));
  }

  async updateCategory(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: { name?: string; sortOrder?: number; notes?: string | null; active?: boolean },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.categories.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Rubro no encontrado');
    const prevName = row.name;
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Nombre obligatorio');
      row.name = name;
    }
    if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
    if (dto.notes !== undefined) row.notes = dto.notes?.trim() || null;
    if (dto.active !== undefined) row.active = dto.active;
    const saved = await this.categories.save(row);
    if (saved.name !== prevName) {
      await this.products.update(
        { shopId, categoryId: id },
        { category: saved.name },
      );
      await this.backfillLinesByCategoryId(shopId, id, saved.name, undefined);
    }
    return this.toCategoryDto(saved);
  }

  async removeCategory(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.categories.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Rubro no encontrado');
    row.active = false;
    await this.categories.save(row);
    return { ok: true };
  }

  // ─── Subcategories ──────────────────────────────────────────

  async listSubcategories(user: AuthUser, shopId: string, categoryId?: string | null) {
    this.shops.assertShopAccess(user, shopId);
    const qb = this.subcategories
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.category', 'c')
      .where('s.shopId = :shopId', { shopId })
      .andWhere('s.active = 1')
      .orderBy('c.sortOrder', 'ASC')
      .addOrderBy('s.sortOrder', 'ASC')
      .addOrderBy('s.name', 'ASC');
    if (categoryId) qb.andWhere('s.categoryId = :categoryId', { categoryId });
    const rows = await qb.getMany();
    return rows.map((s) => this.toSubcategoryDto(s));
  }

  async createSubcategory(
    user: AuthUser,
    shopId: string,
    dto: {
      categoryId: string;
      name: string;
      sortOrder?: number;
      notes?: string | null;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const cat = await this.categories.findOne({
      where: { id: dto.categoryId, shopId, active: true },
    });
    if (!cat) throw new BadRequestException('Rubro no encontrado');
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Nombre obligatorio');
    const exists = await this.subcategories.findOne({
      where: { shopId, categoryId: dto.categoryId, name },
    });
    if (exists?.active) throw new BadRequestException('Ya existe ese subrubro');
    const row =
      exists ??
      this.subcategories.create({
        shopId,
        categoryId: dto.categoryId,
        name,
        sortOrder: 0,
        active: true,
      });
    row.name = name;
    row.categoryId = dto.categoryId;
    row.sortOrder = dto.sortOrder ?? row.sortOrder ?? 0;
    row.notes = dto.notes?.trim() || null;
    row.active = true;
    row.deletedAt = undefined;
    const saved = await this.subcategories.save(row);
    saved.category = cat;
    return this.toSubcategoryDto(saved);
  }

  async updateSubcategory(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: {
      categoryId?: string;
      name?: string;
      sortOrder?: number;
      notes?: string | null;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.subcategories.findOne({
      where: { id, shopId },
      relations: ['category'],
    });
    if (!row) throw new NotFoundException('Subrubro no encontrado');
    const prevName = row.name;
    if (dto.categoryId !== undefined) {
      const cat = await this.categories.findOne({
        where: { id: dto.categoryId, shopId, active: true },
      });
      if (!cat) throw new BadRequestException('Rubro no encontrado');
      row.categoryId = dto.categoryId;
      row.category = cat;
    }
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Nombre obligatorio');
      row.name = name;
    }
    if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
    if (dto.notes !== undefined) row.notes = dto.notes?.trim() || null;
    if (dto.active !== undefined) row.active = dto.active;
    const saved = await this.subcategories.save(row);
    if (saved.name !== prevName || dto.categoryId !== undefined) {
      const catName = saved.category?.name ?? row.category?.name;
      await this.products.update(
        { shopId, subcategoryId: id },
        {
          subcategory: saved.name,
          ...(dto.categoryId
            ? { categoryId: saved.categoryId, category: catName ?? null }
            : {}),
        },
      );
      await this.backfillLinesByCategoryId(
        shopId,
        saved.categoryId,
        catName ?? null,
        saved.name,
      );
    }
    return this.toSubcategoryDto(saved);
  }

  async removeSubcategory(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.subcategories.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Subrubro no encontrado');
    row.active = false;
    await this.subcategories.save(row);
    return { ok: true };
  }

  // ─── Seed from report ───────────────────────────────────────

  /**
   * Crea rubros/subrubros del reporte Kevin + XLS y asigna platos existentes por nombre.
   */
  async seedFromReport(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);

    const categoryByName = new Map<string, PosCategory>();
    for (const seed of SEED_CATEGORIES) {
      let row = await this.categories.findOne({ where: { shopId, name: seed.name } });
      if (!row) {
        row = this.categories.create({
          shopId,
          name: seed.name,
          sortOrder: seed.sortOrder,
          notes: seed.notes ?? null,
          active: true,
        });
      } else {
        row.sortOrder = seed.sortOrder;
        row.notes = seed.notes ?? row.notes;
        row.active = true;
        row.deletedAt = undefined;
      }
      row = await this.categories.save(row);
      categoryByName.set(seed.name, row);
    }

    const subByKey = new Map<string, PosSubcategory>();
    for (const seed of SEED_SUBCATEGORIES) {
      const cat = categoryByName.get(seed.category);
      if (!cat) continue;
      const key = `${seed.category}||${seed.name}`;
      let row = await this.subcategories.findOne({
        where: { shopId, categoryId: cat.id, name: seed.name },
      });
      if (!row) {
        row = this.subcategories.create({
          shopId,
          categoryId: cat.id,
          name: seed.name,
          sortOrder: seed.sortOrder,
          active: true,
        });
      } else {
        row.sortOrder = seed.sortOrder;
        row.active = true;
        row.deletedAt = undefined;
      }
      row = await this.subcategories.save(row);
      subByKey.set(key, row);
    }

    const seedByCode = new Map<string, SeedProduct>();
    const seedByName = new Map<string, SeedProduct>();
    for (const p of allSeedProducts()) {
      const c = normProductCode(p.code);
      if (c) seedByCode.set(c, p);
      seedByName.set(normProductName(p.name), p);
    }

    const products = await this.products.find({ where: { shopId, active: true } });
    let assigned = 0;
    let skipped = 0;
    const unmatched: string[] = [];

    for (const product of products) {
      const code = normProductCode(product.productCode);
      if (code && code !== product.productCode) {
        product.productCode = code;
      }

      const seed =
        (code ? seedByCode.get(code) : undefined) ??
        seedByName.get(normProductName(product.productName ?? ''));

      let catName: string | null = seed?.category ?? null;
      let subName: string | null = seed?.subcategory ?? null;

      // Restosoft no trae subrubros de vinos: inferir cepa por nombre si hace falta.
      if ((!catName || catName === 'VINOS') && !subName) {
        const wineSub = guessWineVarietyFromName(product.productName);
        if (wineSub) {
          catName = 'VINOS';
          subName = wineSub;
        }
      }

      if (!catName) {
        const guess = code ? guessByCodeRange(code) : null;
        if (guess) {
          catName = guess.category;
          subName = guess.subcategory;
        }
      }

      // Sin cepa identificable no cargamos VINOS (ni “Otros” inventado).
      if (catName === 'VINOS' && !subName) {
        skipped++;
        unmatched.push(`${product.productCode ?? '?'} ${product.productName ?? ''}`.trim());
        continue;
      }
      if (!catName && looksLikeWineWithoutVariety(product.productName)) {
        skipped++;
        unmatched.push(`${product.productCode ?? '?'} ${product.productName ?? ''}`.trim());
        continue;
      }

      if (!catName) {
        skipped++;
        unmatched.push(`${product.productCode ?? '?'} ${product.productName ?? ''}`.trim());
        continue;
      }

      const cat = categoryByName.get(catName);
      const sub = subName ? subByKey.get(`${catName}||${subName}`) : undefined;
      if (!cat || (catName === 'VINOS' && !sub)) {
        skipped++;
        unmatched.push(`${product.productCode ?? '?'} ${product.productName ?? ''}`.trim());
        continue;
      }

      product.categoryId = cat.id;
      product.category = cat.name;
      product.subcategoryId = sub?.id ?? null;
      product.subcategory = sub?.name ?? null;
      await this.products.save(product);
      await this.lines.query(
        `UPDATE pos_sale_ticket_lines l
         INNER JOIN pos_sale_tickets t ON t.id = l.ticketId
         SET l.category = ?, l.subcategory = ?
         WHERE t.shopId = ? AND (
           l.productCode = ? OR l.productCode = ? OR l.productCode = ?
         ) AND t.deletedAt IS NULL`,
        [
          product.category,
          product.subcategory,
          shopId,
          product.productCode,
          code,
          code ? `${code}.0` : product.productCode,
        ],
      );
      assigned++;
    }

    return {
      categories: SEED_CATEGORIES.length,
      subcategories: SEED_SUBCATEGORIES.length,
      productsAssigned: assigned,
      productsSkipped: skipped,
      seedProductNames: allSeedProducts().length,
      unmatched: unmatched.slice(0, 30),
    };
  }

  /** Resuelve rubro/subrubro para un producto (import / upsert). */
  async resolveLabels(
    shopId: string,
    productCode: string,
  ): Promise<{ category: string | null; subcategory: string | null }> {
    const p = await this.products.findOne({
      where: { shopId, productCode, active: true },
    });
    return {
      category: p?.category ?? null,
      subcategory: p?.subcategory ?? null,
    };
  }

  async resolveLabelsMap(
    shopId: string,
  ): Promise<Map<string, { category: string | null; subcategory: string | null }>> {
    const rows = await this.products.find({ where: { shopId, active: true } });
    return new Map(
      rows.map((p) => [
        p.productCode,
        { category: p.category ?? null, subcategory: p.subcategory ?? null },
      ]),
    );
  }

  private async backfillLinesByCategoryId(
    shopId: string,
    categoryId: string,
    categoryName: string | null,
    subcategoryName: string | null | undefined,
  ) {
    const products = await this.products.find({
      where: { shopId, categoryId, active: true },
    });
    for (const p of products) {
      const sub =
        subcategoryName !== undefined ? subcategoryName : (p.subcategory ?? null);
      await this.lines.query(
        `UPDATE pos_sale_ticket_lines l
         INNER JOIN pos_sale_tickets t ON t.id = l.ticketId
         SET l.category = ?, l.subcategory = ?
         WHERE t.shopId = ? AND l.productCode = ? AND t.deletedAt IS NULL`,
        [categoryName, sub, shopId, p.productCode],
      );
    }
  }

  private toCategoryDto(c: PosCategory) {
    return {
      id: c.id,
      shopId: c.shopId,
      name: c.name,
      sortOrder: c.sortOrder,
      notes: c.notes ?? null,
      active: c.active,
    };
  }

  private toSubcategoryDto(s: PosSubcategory) {
    return {
      id: s.id,
      shopId: s.shopId,
      categoryId: s.categoryId,
      categoryName: s.category?.name ?? null,
      name: s.name,
      sortOrder: s.sortOrder,
      notes: s.notes ?? null,
      active: s.active,
    };
  }
}
