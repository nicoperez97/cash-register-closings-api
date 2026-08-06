import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StockCategory } from '../../entities/stock-category.entity';
import { StockProduct } from '../../entities/stock-product.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import { NotificationType } from '../../common/enums';
import { isEntityActive } from '../../common/active.util';
import { ShopsService } from '../shops/shops.service';
import { NotificationsService } from '../notifications/notifications.service';

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
          name VARCHAR(200) NOT NULL,
          minQuantity DECIMAL(12,2) NOT NULL DEFAULT 0,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX idx_stock_categories_shop (shopId)
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
          categoryId CHAR(36) NOT NULL,
          name VARCHAR(200) NOT NULL,
          quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX idx_stock_products_shop (shopId),
          INDEX idx_stock_products_category (categoryId)
        )
      `);
    } catch {
      // ya existe
    }
  }

  private categoryDto(c: StockCategory) {
    return {
      id: c.id,
      shopId: c.shopId,
      name: c.name,
      minQuantity: n(c.minQuantity),
      active: isEntityActive(c.active),
    };
  }

  private productDto(p: StockProduct, category?: StockCategory | null) {
    const cat = category ?? p.category ?? null;
    const minQuantity = n(cat?.minQuantity);
    const quantity = n(p.quantity);
    return {
      id: p.id,
      shopId: p.shopId,
      categoryId: p.categoryId,
      categoryName: cat?.name ?? null,
      minQuantity,
      name: p.name,
      quantity,
      belowMinimum: quantity < minQuantity,
      active: isEntityActive(p.active),
    };
  }

  // ─── Categories ───────────────────────────────────────────────

  async listCategories(user: AuthUser, shopId: string, includeInactive = false) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.categories.find({
      where: { shopId },
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
    dto: { name: string; minQuantity?: number; active?: boolean },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Indicá el nombre de la categoría');
    const row = await this.categories.save(
      this.categories.create({
        shopId,
        name,
        minQuantity: qty(n(dto.minQuantity)),
        active: dto.active ?? true,
      }),
    );
    return this.categoryDto(row);
  }

  async updateCategory(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: { name?: string; minQuantity?: number; active?: boolean },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.categories.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Categoría no encontrada');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Indicá el nombre de la categoría');
      row.name = name;
    }
    if (dto.minQuantity !== undefined) row.minQuantity = qty(n(dto.minQuantity));
    if (dto.active !== undefined) row.active = dto.active;
    await this.categories.save(row);
    return this.categoryDto(row);
  }

  async removeCategory(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.categories.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Categoría no encontrada');
    const products = await this.products.find({ where: { shopId, categoryId: id } });
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

  async listProducts(user: AuthUser, shopId: string, includeInactive = false) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.products.find({
      where: { shopId },
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
    dto: {
      categoryId?: string | null;
      newCategory?: { name: string; minQuantity?: number } | null;
    },
  ): Promise<StockCategory> {
    if (dto.newCategory?.name?.trim()) {
      return this.categories.save(
        this.categories.create({
          shopId,
          name: dto.newCategory.name.trim(),
          minQuantity: qty(n(dto.newCategory.minQuantity)),
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
    return cat;
  }

  async createProduct(
    user: AuthUser,
    shopId: string,
    dto: {
      name: string;
      categoryId?: string | null;
      newCategory?: { name: string; minQuantity?: number } | null;
      quantity?: number;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Indicá el nombre del producto');
    const category = await this.resolveCategory(shopId, dto);
    const row = await this.products.save(
      this.products.create({
        shopId,
        categoryId: category.id,
        name,
        quantity: qty(n(dto.quantity)),
        active: dto.active ?? true,
      }),
    );
    return this.productDto(row, category);
  }

  async updateProduct(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: {
      name?: string;
      categoryId?: string | null;
      newCategory?: { name: string; minQuantity?: number } | null;
      quantity?: number;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.products.findOne({
      where: { id, shopId },
      relations: ['category'],
    });
    if (!row) throw new NotFoundException('Producto no encontrado');

    let category = row.category ?? null;
    if (dto.newCategory?.name?.trim() || dto.categoryId !== undefined) {
      category = await this.resolveCategory(shopId, dto);
      row.categoryId = category.id;
    }
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Indicá el nombre del producto');
      row.name = name;
    }
    if (dto.quantity !== undefined) row.quantity = qty(n(dto.quantity));
    if (dto.active !== undefined) row.active = dto.active;
    await this.products.save(row);

    if (!category || category.id !== row.categoryId) {
      category = await this.categories.findOne({ where: { id: row.categoryId, shopId } });
    }
    return this.productDto(row, category);
  }

  async removeProduct(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.products.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Producto no encontrado');
    row.active = false;
    await this.products.save(row);
    return { ok: true };
  }

  async adjustQuantity(
    user: AuthUser,
    shopId: string,
    id: string,
    delta: number,
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (delta !== 1 && delta !== -1) {
      throw new BadRequestException('El ajuste debe ser +1 o -1');
    }
    const row = await this.products.findOne({
      where: { id, shopId },
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

    const min = n(category.minQuantity);
    const crossedBelow = before >= min && after < min;
    if (crossedBelow) {
      void this.notifyStockAdmins(user, shopId, row, category, after).catch((err) => {
        this.logger.warn(
          `No se pudo notificar stock bajo: ${(err as Error)?.message ?? err}`,
        );
      });
    }

    return this.productDto(row, category);
  }

  private async notifyStockAdmins(
    actor: AuthUser,
    shopId: string,
    product: StockProduct,
    category: StockCategory,
    quantity: number,
  ) {
    const links = await this.userShops.find({ where: { shopId } });
    const recipientIds = new Set(
      links.filter((l) => !!l.isStockAdmin).map((l) => l.userId),
    );
    recipientIds.delete(actor.id);
    if (!recipientIds.size) return;

    const qtyLabel = quantity.toLocaleString('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    const minLabel = n(category.minQuantity).toLocaleString('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });

    await this.notifications.createMany(
      [...recipientIds].map((userId) => ({
        userId,
        shopId,
        type: NotificationType.STOCK_BELOW_MINIMUM,
        title: 'Stock bajo el mínimo',
        body: `El producto «${product.name}» quedó en ${qtyLabel} (mínimo ${minLabel} en ${category.name}).`,
      })),
    );
  }
}
