import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { StockCategory } from '../../entities/stock-category.entity';
import { StockProduct } from '../../entities/stock-product.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { ShopsService } from '../shops/shops.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  StockKind,
  stockAdminFlag,
  stockBelowType,
  stockLabel,
  stockSharedType,
} from './stock-kind';

const n = (v?: string | number | null) => Number(v ?? 0);
const qty = (v: number) => Math.max(0, Number(v) || 0).toFixed(2);

@Injectable()
export class StockService implements OnModuleInit {
  private readonly logger = new Logger(StockService.name);

  constructor(
    @InjectRepository(StockCategory)
    private readonly categories: Repository<StockCategory>,
    @InjectRepository(StockProduct)
    private readonly products: Repository<StockProduct>,
    @InjectRepository(UserShop)
    private readonly userShops: Repository<UserShop>,
    private readonly shops: ShopsService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    try {
      await this.categories.query(`
        CREATE TABLE IF NOT EXISTS stock_categories (
          id CHAR(36) NOT NULL PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          kind VARCHAR(20) NOT NULL DEFAULT 'food',
          name VARCHAR(200) NOT NULL,
          minQuantity DECIMAL(12,2) NOT NULL DEFAULT 0,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX idx_stock_categories_shop (shopId),
          INDEX idx_stock_categories_shop_kind (shopId, kind)
        )
      `);
    } catch {
      // ya existe
    }
    try {
      await this.products.query(`
        CREATE TABLE IF NOT EXISTS stock_products (
          id CHAR(36) NOT NULL PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          kind VARCHAR(20) NOT NULL DEFAULT 'food',
          categoryId CHAR(36) NOT NULL,
          name VARCHAR(200) NOT NULL,
          quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
          minQuantity DECIMAL(12,2) NOT NULL DEFAULT 0,
          maxQuantity DECIMAL(12,2) NOT NULL DEFAULT 0,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX idx_stock_products_shop (shopId),
          INDEX idx_stock_products_shop_kind (shopId, kind),
          INDEX idx_stock_products_category (categoryId)
        )
      `);
    } catch {
      // ya existe
    }
    try {
      await this.products.query(`
        ALTER TABLE stock_products
          ADD COLUMN maxQuantity DECIMAL(12,2) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.products.query(`
        ALTER TABLE stock_products
          ADD COLUMN minQuantity DECIMAL(12,2) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.categories.query(`
        ALTER TABLE stock_categories
          ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'food'
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.products.query(`
        ALTER TABLE stock_products
          ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'food'
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.categories.query(`
        CREATE INDEX idx_stock_categories_shop ON stock_categories (shopId)
      `);
    } catch {
      // índice ya existe
    }
    try {
      await this.products.query(`
        CREATE INDEX idx_stock_products_shop ON stock_products (shopId)
      `);
    } catch {
      // índice ya existe
    }
    try {
      await this.categories.query(`
        CREATE INDEX idx_stock_categories_shop_kind ON stock_categories (shopId, kind)
      `);
    } catch {
      // índice ya existe
    }
    try {
      await this.products.query(`
        CREATE INDEX idx_stock_products_shop_kind ON stock_products (shopId, kind)
      `);
    } catch {
      // índice ya existe
    }
    try {
      await this.products.query(`
        CREATE TABLE IF NOT EXISTS app_meta (
          metaKey VARCHAR(100) NOT NULL PRIMARY KEY,
          metaValue VARCHAR(255) NULL,
          updatedAt DATETIME(6) NULL
        )
      `);
      const rows: Array<{ c: number }> = await this.products.query(
        `SELECT COUNT(*) AS c FROM app_meta WHERE metaKey = 'stock_min_on_product_v1'`,
      );
      const done = Number(rows?.[0]?.c ?? 0) > 0;
      if (!done) {
        await this.products.query(`
          UPDATE stock_products p
          INNER JOIN stock_categories c ON c.id = p.categoryId
          SET p.minQuantity = c.minQuantity
          WHERE c.minQuantity IS NOT NULL AND c.minQuantity > 0
        `);
        await this.products.query(`
          INSERT INTO app_meta (metaKey, metaValue, updatedAt)
          VALUES ('stock_min_on_product_v1', '1', NOW(6))
        `);
      }
    } catch {
      // ignore
    }
  }

  private categoryDto(c: StockCategory) {
    return {
      id: c.id,
      shopId: c.shopId,
      kind: (c.kind as StockKind) || 'food',
      name: c.name,
      active: isEntityActive(c.active),
    };
  }

  private productDto(p: StockProduct, category?: StockCategory | null) {
    const cat = category ?? p.category ?? null;
    const minQuantity = n(p.minQuantity);
    const quantity = n(p.quantity);
    const maxQuantity = n(p.maxQuantity);
    return {
      id: p.id,
      shopId: p.shopId,
      kind: (p.kind as StockKind) || 'food',
      categoryId: p.categoryId,
      categoryName: cat?.name ?? null,
      minQuantity,
      maxQuantity,
      name: p.name,
      quantity,
      belowMinimum: quantity < minQuantity,
      active: isEntityActive(p.active),
    };
  }

  // ─── Categories ───────────────────────────────────────────────

  async listCategories(
    user: AuthUser,
    shopId: string,
    kind: StockKind,
    includeInactive = false,
  ) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.categories.find({
      where: { shopId, kind },
      order: { name: 'ASC' },
    });
    const filtered = includeInactive
      ? rows
      : rows.filter((r) => isEntityActive(r.active));
    return filtered.map((r) => this.categoryDto(r));
  }

  async createCategory(
    user: AuthUser,
    shopId: string,
    kind: StockKind,
    dto: { name: string; active?: boolean },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Indicá el nombre de la categoría');
    const row = await this.categories.save(
      this.categories.create({
        shopId,
        kind,
        name,
        active: dto.active ?? true,
      }),
    );
    return this.categoryDto(row);
  }

  async updateCategory(
    user: AuthUser,
    shopId: string,
    kind: StockKind,
    id: string,
    dto: { name?: string; active?: boolean },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.categories.findOne({ where: { id, shopId, kind } });
    if (!row) throw new NotFoundException('Categoría no encontrada');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Indicá el nombre de la categoría');
      row.name = name;
    }
    if (dto.active !== undefined) row.active = dto.active;
    await this.categories.save(row);
    return this.categoryDto(row);
  }

  async removeCategory(user: AuthUser, shopId: string, kind: StockKind, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.categories.findOne({ where: { id, shopId, kind } });
    if (!row) throw new NotFoundException('Categoría no encontrada');
    const products = await this.products.find({
      where: { shopId, categoryId: id, kind },
    });
    const activeLinked = products.filter((p) => isEntityActive(p.active)).length;
    if (activeLinked > 0) {
      throw new BadRequestException(
        'No se puede ocultar una categoría con productos activos. Reasigná o ocultá los productos primero.',
      );
    }
    row.active = false;
    await this.categories.save(row);
    return { ok: true };
  }

  // ─── Products ─────────────────────────────────────────────────

  async listProducts(
    user: AuthUser,
    shopId: string,
    kind: StockKind,
    includeInactive = false,
  ) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.products.find({
      where: { shopId, kind },
      relations: ['category'],
      order: { name: 'ASC' },
    });
    const filtered = includeInactive
      ? rows
      : rows.filter((r) => isEntityActive(r.active));
    return filtered.map((r) => this.productDto(r, r.category));
  }

  private async resolveCategory(
    shopId: string,
    kind: StockKind,
    dto: {
      categoryId?: string | null;
      newCategory?: { name: string } | null;
    },
  ): Promise<StockCategory> {
    if (dto.newCategory?.name?.trim()) {
      return this.categories.save(
        this.categories.create({
          shopId,
          kind,
          name: dto.newCategory.name.trim(),
          active: true,
        }),
      );
    }
    if (!dto.categoryId) {
      throw new BadRequestException('Seleccioná o creá una categoría');
    }
    const cat = await this.categories.findOne({
      where: { id: dto.categoryId, shopId },
    });
    if (!cat || !isEntityActive(cat.active)) {
      throw new BadRequestException('Categoría no encontrada');
    }
    if ((cat.kind || 'food') !== kind) {
      throw new BadRequestException(
        `La categoría no pertenece al stock de ${stockLabel(kind)}`,
      );
    }
    return cat;
  }

  async createProduct(
    user: AuthUser,
    shopId: string,
    kind: StockKind,
    dto: {
      name: string;
      categoryId?: string | null;
      newCategory?: { name: string } | null;
      quantity?: number;
      minQuantity?: number;
      maxQuantity?: number;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Indicá el nombre del producto');
    const category = await this.resolveCategory(shopId, kind, dto);
    const row = await this.products.save(
      this.products.create({
        shopId,
        kind,
        categoryId: category.id,
        name,
        quantity: qty(n(dto.quantity)),
        minQuantity: qty(n(dto.minQuantity)),
        maxQuantity: qty(n(dto.maxQuantity)),
        active: dto.active ?? true,
      }),
    );
    return this.productDto(row, category);
  }

  async updateProduct(
    user: AuthUser,
    shopId: string,
    kind: StockKind,
    id: string,
    dto: {
      name?: string;
      categoryId?: string | null;
      newCategory?: { name: string } | null;
      quantity?: number;
      minQuantity?: number;
      maxQuantity?: number;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.products.findOne({
      where: { id, shopId, kind },
      relations: ['category'],
    });
    if (!row) throw new NotFoundException('Producto no encontrado');

    let category = row.category ?? null;
    if (dto.newCategory?.name?.trim() || dto.categoryId !== undefined) {
      category = await this.resolveCategory(shopId, kind, dto);
      row.categoryId = category.id;
    }
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Indicá el nombre del producto');
      row.name = name;
    }
    if (dto.quantity !== undefined) row.quantity = qty(n(dto.quantity));
    if (dto.minQuantity !== undefined) row.minQuantity = qty(n(dto.minQuantity));
    if (dto.maxQuantity !== undefined) row.maxQuantity = qty(n(dto.maxQuantity));
    if (dto.active !== undefined) row.active = dto.active;
    await this.products.save(row);

    if (!category || category.id !== row.categoryId) {
      category = await this.categories.findOne({ where: { id: row.categoryId, shopId } });
    }
    return this.productDto(row, category);
  }

  async restockProducts(
    user: AuthUser,
    shopId: string,
    kind: StockKind,
    productIds: string[],
  ) {
    this.shops.assertShopAccess(user, shopId);
    const ids = [...new Set((productIds ?? []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('Seleccioná al menos un producto');

    const rows = await this.products.find({
      where: { shopId, kind, id: In(ids) },
      relations: ['category'],
    });
    if (!rows.length) throw new NotFoundException('Productos no encontrados');

    const updated: ReturnType<StockService['productDto']>[] = [];
    const skipped: string[] = [];

    for (const row of rows) {
      if (!isEntityActive(row.active)) {
        skipped.push(row.name);
        continue;
      }
      const max = n(row.maxQuantity);
      if (!(max > 0)) {
        skipped.push(row.name);
        continue;
      }
      row.quantity = qty(max);
      await this.products.save(row);
      updated.push(this.productDto(row, row.category));
    }

    if (!updated.length) {
      throw new BadRequestException(
        'Ningún producto se pudo reponer. Configurá un stock máximo mayor a 0.',
      );
    }

    return { products: updated, skipped };
  }

  async removeProduct(user: AuthUser, shopId: string, kind: StockKind, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.products.findOne({ where: { id, shopId, kind } });
    if (!row) throw new NotFoundException('Producto no encontrado');
    row.active = false;
    await this.products.save(row);
    return { ok: true };
  }

  async listStockAdmins(user: AuthUser, shopId: string, kind: StockKind) {
    this.shops.assertShopAccess(user, shopId);
    const flag = stockAdminFlag(kind);
    const links = await this.userShops.find({
      where: { shopId, [flag]: true },
      relations: ['user'],
    });
    return links
      .filter((l) => l.user && isEntityActive(l.user.active))
      .map((l) => ({
        id: l.userId,
        fullName: l.user.fullName,
        email: l.user.email,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' }));
  }

  async shareStock(
    user: AuthUser,
    shopId: string,
    kind: StockKind,
    recipientUserIds?: string[] | null,
  ) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne(user, shopId);
    const shopName = shop?.name ?? 'Local';
    const label = stockLabel(kind);
    const flag = stockAdminFlag(kind);

    const links = await this.userShops.find({
      where: { shopId, [flag]: true },
      relations: ['user'],
    });
    let recipients = links.filter((l) => l.user && isEntityActive(l.user.active));

    if (Array.isArray(recipientUserIds)) {
      if (!recipientUserIds.length) {
        throw new BadRequestException(
          `Seleccioná al menos un administrador de stock de ${label}`,
        );
      }
      const allowed = new Set(recipientUserIds);
      recipients = recipients.filter((l) => allowed.has(l.userId));
    }
    if (!recipients.length) {
      throw new BadRequestException(
        `No hay administradores de stock de ${label} para notificar. Marcá al menos uno en Usuarios.`,
      );
    }

    const products = await this.listProducts(user, shopId, kind, false);
    const { shareText, notifyBody, title } = this.buildStockSharePayload(
      shopName,
      user.fullName ?? 'Alguien',
      products,
      kind,
    );

    await this.notifications.createMany(
      recipients.map((l) => ({
        userId: l.userId,
        shopId,
        type: stockSharedType(kind),
        title,
        body: notifyBody,
      })),
    );

    return {
      ok: true,
      notified: recipients.length,
      title,
      shareText,
    };
  }

  async adjustQuantity(
    user: AuthUser,
    shopId: string,
    kind: StockKind,
    id: string,
    delta: number,
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (delta !== 1 && delta !== -1) {
      throw new BadRequestException('El ajuste debe ser +1 o -1');
    }
    const row = await this.products.findOne({
      where: { id, shopId, kind },
      relations: ['category'],
    });
    if (!row || !isEntityActive(row.active)) {
      throw new NotFoundException('Producto no encontrado');
    }
    const category = row.category;
    if (!category) throw new BadRequestException('El producto no tiene categoría');

    const before = n(row.quantity);
    const after = Math.max(0, before + delta);
    row.quantity = qty(after);
    await this.products.save(row);

    const min = n(row.minQuantity);
    const crossedBelow = before >= min && after < min;
    if (crossedBelow) {
      void this.notifyStockAdmins(shopId, kind, row, category, after, min).catch((err) => {
        this.logger.warn(
          `No se pudo notificar stock bajo: ${(err as Error)?.message ?? err}`,
        );
      });
    }

    return this.productDto(row, category);
  }

  private buildStockSharePayload(
    shopName: string,
    actorName: string,
    products: Array<{
      name: string;
      quantity: number;
      minQuantity: number;
      belowMinimum: boolean;
      categoryName?: string | null;
    }>,
    kind: StockKind,
  ) {
    const fmt = (v: number) =>
      v.toLocaleString('es-AR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });

    const label = stockLabel(kind);
    const below = products.filter((p) => p.belowMinimum);
    const title = `Stock ${label} · ${shopName}`;
    const header = `${actorName} compartió el stock de ${label} de ${shopName}`;
    const summary = `${products.length} producto${products.length === 1 ? '' : 's'}${
      below.length ? ` · ${below.length} bajo mínimo` : ''
    }`;

    const sorted = [...products].sort((a, b) => {
      const qtyDiff = Number(a.quantity) - Number(b.quantity);
      if (qtyDiff !== 0) return qtyDiff;
      const marginA = Number(a.quantity) - Number(a.minQuantity);
      const marginB = Number(b.quantity) - Number(b.minQuantity);
      if (marginA !== marginB) return marginA - marginB;
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    });

    const lines = sorted.map((p) => {
      const cat = p.categoryName ? ` (${p.categoryName})` : '';
      const low = p.belowMinimum ? ' ⚠' : '';
      return `• ${p.name}${cat}: ${fmt(p.quantity)} (mín. ${fmt(p.minQuantity)})${low}`;
    });

    const shareText = [header, summary, '', ...lines].join('\n');

    // Misma lista que el share, recortada si hace falta (un ítem por línea).
    const maxLines = 40;
    const listed = lines.slice(0, maxLines);
    const more =
      lines.length > listed.length ? `\n…y ${lines.length - listed.length} productos más` : '';

    let notifyBody = [header, summary, '', ...listed].join('\n') + more;
    if (notifyBody.length > 1900) {
      // Recortar por líneas para no partir un ítem a la mitad.
      const kept: string[] = [];
      let size = 0;
      for (const line of [header, summary, '', ...listed]) {
        const next = kept.length ? size + 1 + line.length : line.length;
        if (next > 1890) break;
        kept.push(line);
        size = next;
      }
      notifyBody = kept.join('\n') + '\n…';
    }

    return { title, shareText, notifyBody };
  }

  /** Avisa a todos los admins del kind del local (incluye quien bajó el stock). */
  private async notifyStockAdmins(
    shopId: string,
    kind: StockKind,
    product: StockProduct,
    category: StockCategory,
    quantity: number,
    minQuantity: number,
  ) {
    const links = await this.userShops.find({ where: { shopId } });
    const flag = stockAdminFlag(kind);
    const recipientIds = [
      ...new Set(links.filter((l) => !!l[flag]).map((l) => l.userId)),
    ];
    if (!recipientIds.length) return;

    const qtyLabel = quantity.toLocaleString('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    const minLabel = minQuantity.toLocaleString('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    const label = stockLabel(kind);

    await this.notifications.createMany(
      recipientIds.map((userId) => ({
        userId,
        shopId,
        type: stockBelowType(kind),
        title: `Stock de ${label} bajo el mínimo`,
        body: `El producto «${product.name}» quedó en ${qtyLabel} (mínimo ${minLabel}${category?.name ? `, ${category.name}` : ''}).`,
      })),
    );
  }
}
