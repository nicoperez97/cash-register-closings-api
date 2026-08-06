import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../../common/decorators';
import { PosCategory } from '../../entities/pos-category.entity';
import { PosSubcategory } from '../../entities/pos-subcategory.entity';
import { PosProduct } from '../../entities/pos-product.entity';
import { PosSaleTicketLine } from '../../entities/pos-sale-ticket-line.entity';
import { ShopsService } from '../shops/shops.service';
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

@Injectable()
export class PosCatalogService {
  constructor(
    @InjectRepository(PosCategory) private readonly categories: Repository<PosCategory>,
    @InjectRepository(PosSubcategory)
    private readonly subcategories: Repository<PosSubcategory>,
    @InjectRepository(PosProduct) private readonly products: Repository<PosProduct>,
    @InjectRepository(PosSaleTicketLine)
    private readonly lines: Repository<PosSaleTicketLine>,
    private readonly shops: ShopsService,
  ) {}

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
