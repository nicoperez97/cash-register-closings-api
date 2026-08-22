import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { Order } from '../../entities/order.entity';
import { OrderLine } from '../../entities/order-line.entity';
import { StockProduct } from '../../entities/stock-product.entity';
import { Shortage } from '../../entities/shortage.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { ShopsService } from '../shops/shops.service';
import { StockService } from '../stock/stock.service';
import { StockKind } from '../stock/stock-kind';
import {
  deleteUploadIfExists,
  resolveUploadPath,
  saveUploadFile,
} from '../../common/uploads';

export type OrderSource = 'food' | 'beverage' | 'shortage';

export type OrderLineInput = {
  source: OrderSource;
  productId?: string | null;
  shortageId?: string | null;
  quantity: number;
};

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => Math.max(0, Number(v) || 0).toFixed(2);

@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderLine) private readonly lines: Repository<OrderLine>,
    @InjectRepository(StockProduct) private readonly products: Repository<StockProduct>,
    @InjectRepository(Shortage) private readonly shortages: Repository<Shortage>,
    private readonly shops: ShopsService,
    private readonly stock: StockService,
  ) {}

  async onModuleInit() {
    try {
      await this.orders.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id CHAR(36) NOT NULL PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          orderDate DATE NOT NULL,
          notes VARCHAR(500) NULL,
          invoiceFilePath VARCHAR(500) NULL,
          invoiceFileName VARCHAR(255) NULL,
          invoiceFileMime VARCHAR(120) NULL,
          createdByUserId CHAR(36) NULL,
          stockApplied TINYINT(1) NOT NULL DEFAULT 0,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX idx_orders_shop_date (shopId, orderDate)
        )
      `);
    } catch {
      // ya existe
    }
    try {
      await this.lines.query(`
        CREATE TABLE IF NOT EXISTS order_lines (
          id CHAR(36) NOT NULL PRIMARY KEY,
          orderId CHAR(36) NOT NULL,
          shopId CHAR(36) NOT NULL,
          source VARCHAR(20) NOT NULL,
          productId CHAR(36) NULL,
          shortageId CHAR(36) NULL,
          nameSnapshot VARCHAR(200) NOT NULL,
          quantity DECIMAL(12,2) NOT NULL,
          sortOrder INT NOT NULL DEFAULT 0,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX idx_order_lines_order (orderId)
        )
      `);
    } catch {
      // ya existe
    }
  }

  async list(user: AuthUser, shopId: string, filters: { from?: string; to?: string } = {}) {
    this.shops.assertShopAccess(user, shopId);
    const qb = this.orders
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.lines', 'line')
      .where('o.shopId = :shopId', { shopId })
      .andWhere('o.active = true')
      .orderBy('o.orderDate', 'DESC')
      .addOrderBy('o.createdAt', 'DESC');
    if (filters.from) qb.andWhere('o.orderDate >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('o.orderDate <= :to', { to: filters.to });
    const rows = await qb.getMany();
    return rows.map((r) => this.toDto(r));
  }

  async one(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.orders.findOne({
      where: { id, shopId },
      relations: ['lines'],
    });
    if (!row || !isEntityActive(row.active)) throw new NotFoundException('Pedido no encontrado');
    return this.toDto(row);
  }

  async create(
    user: AuthUser,
    shopId: string,
    dto: { orderDate: string; notes?: string | null; lines: OrderLineInput[] },
    file?: Express.Multer.File,
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (!file?.buffer?.length) throw new BadRequestException('La factura es obligatoria');
    const orderDate = String(dto.orderDate ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) {
      throw new BadRequestException('Fecha inválida');
    }
    const rawLines = Array.isArray(dto.lines) ? dto.lines : [];
    if (!rawLines.length) throw new BadRequestException('Cargá al menos un material');

    const resolved = await this.resolveLines(shopId, rawLines);
    const id = randomUUID();
    const savedFile = saveUploadFile({
      relativeDir: `orders/${shopId}/${id}`,
      basename: 'invoice',
      buffer: file.buffer,
      originalName: file.originalname,
      mime: file.mimetype,
    });

    const order = await this.orders.save(
      this.orders.create({
        id,
        shopId,
        orderDate,
        notes: dto.notes?.trim() || null,
        invoiceFilePath: savedFile.relativePath,
        invoiceFileName: file.originalname || savedFile.fileName,
        invoiceFileMime: file.mimetype || null,
        createdByUserId: user.id,
        stockApplied: false,
        active: true,
      }),
    );

    const lineRows = resolved.map((line, i) =>
      this.lines.create({
        shopId,
        orderId: order.id,
        source: line.source,
        productId: line.productId,
        shortageId: line.shortageId,
        nameSnapshot: line.nameSnapshot,
        quantity: money(line.quantity),
        sortOrder: i,
        active: true,
      }),
    );
    await this.lines.save(lineRows);

    await this.applyStock(user, shopId, resolved, 1);
    order.stockApplied = true;
    await this.orders.save(order);

    const saved = await this.orders.findOne({
      where: { id: order.id, shopId },
      relations: ['lines'],
    });
    return this.toDto(saved!);
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.orders.findOne({
      where: { id, shopId },
      relations: ['lines'],
    });
    if (!row || !isEntityActive(row.active)) throw new NotFoundException('Pedido no encontrado');
    if (row.stockApplied && row.lines?.length) {
      const inputs: Array<OrderLineInput & { nameSnapshot: string; productId: string | null; shortageId: string | null; source: OrderSource; quantity: number }> =
        row.lines.map((l) => ({
          source: l.source as OrderSource,
          productId: l.productId ?? null,
          shortageId: l.shortageId ?? null,
          nameSnapshot: l.nameSnapshot,
          quantity: n(l.quantity),
        }));
      await this.applyStock(user, shopId, inputs, -1);
    }
    deleteUploadIfExists(row.invoiceFilePath);
    await this.lines.softRemove(row.lines ?? []);
    await this.orders.softRemove(row);
    return { ok: true };
  }

  async downloadInvoice(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.orders.findOne({ where: { id, shopId } });
    if (!row || !isEntityActive(row.active)) throw new NotFoundException('Pedido no encontrado');
    const abs = resolveUploadPath(row.invoiceFilePath);
    if (!abs) throw new NotFoundException('No hay factura');
    return {
      stream: new StreamableFile(createReadStream(abs)),
      fileName: row.invoiceFileName || 'factura',
      mime: row.invoiceFileMime || 'application/octet-stream',
    };
  }

  private async resolveLines(shopId: string, lines: OrderLineInput[]) {
    const out: Array<{
      source: OrderSource;
      productId: string | null;
      shortageId: string | null;
      nameSnapshot: string;
      quantity: number;
    }> = [];
    for (const line of lines) {
      const qty = n(line.quantity);
      if (!(qty > 0)) throw new BadRequestException('La cantidad tiene que ser mayor a 0');
      const source = line.source;
      if (source === 'food' || source === 'beverage') {
        const productId = String(line.productId ?? '').trim();
        if (!productId) throw new BadRequestException('Elegí un material de stock');
        const product = await this.products.findOne({
          where: { id: productId, shopId, kind: source },
        });
        if (!product || !isEntityActive(product.active)) {
          throw new BadRequestException(`No encontramos el material (${source === 'beverage' ? 'bebida' : 'alimento'})`);
        }
        out.push({
          source,
          productId: product.id,
          shortageId: null,
          nameSnapshot: product.name,
          quantity: qty,
        });
        continue;
      }
      if (source === 'shortage') {
        const shortageId = String(line.shortageId ?? '').trim();
        if (!shortageId) throw new BadRequestException('Elegí un faltante');
        const shortage = await this.shortages.findOne({ where: { id: shortageId, shopId } });
        if (!shortage || !isEntityActive(shortage.active)) {
          throw new BadRequestException('No encontramos el faltante');
        }
        out.push({
          source,
          productId: null,
          shortageId: shortage.id,
          nameSnapshot: shortage.name,
          quantity: qty,
        });
        continue;
      }
      throw new BadRequestException('Tipo de material inválido');
    }
    return out;
  }

  private async applyStock(
    user: AuthUser,
    shopId: string,
    lines: Array<{ source: OrderSource; productId: string | null; quantity: number }>,
    sign: 1 | -1,
  ) {
    for (const line of lines) {
      if ((line.source === 'food' || line.source === 'beverage') && line.productId) {
        await this.stock.addQuantity(
          user,
          shopId,
          line.source as StockKind,
          line.productId,
          sign * line.quantity,
        );
      }
    }
  }

  private toDto(row: Order) {
    const lines = [...(row.lines ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return {
      id: row.id,
      shopId: row.shopId,
      orderDate: String(row.orderDate ?? '').slice(0, 10),
      notes: row.notes ?? null,
      hasInvoiceFile: !!row.invoiceFilePath,
      invoiceFileName: row.invoiceFileName ?? null,
      createdByUserId: row.createdByUserId ?? null,
      stockApplied: !!row.stockApplied,
      createdAt: row.createdAt,
      lines: lines.map((l) => ({
        id: l.id,
        source: l.source,
        productId: l.productId ?? null,
        shortageId: l.shortageId ?? null,
        name: l.nameSnapshot,
        quantity: n(l.quantity),
      })),
    };
  }
}
