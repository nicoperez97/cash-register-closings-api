import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Movement } from '../../entities/movement.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Concept } from '../../entities/concept.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { Payment } from '../../entities/payment.entity';
import { AuthUser } from '../../common/decorators';
import {
  ConceptKind,
  GlobalRole,
  LedgerAccountType,
  NotificationType,
  PaymentStatus,
  Permission,
} from '../../common/enums';
import { canEditExpenses, isGlobalAdmin, resolveUserPermissions } from '../../common/guards';
import { isEntityActive } from '../../common/active.util';
import { ShopsService } from '../shops/shops.service';
import { CatalogSeedService } from '../../common/catalog-seed.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  deleteUploadIfExists,
  resolveUploadPath,
  saveUploadFile,
} from '../../common/uploads';
import { createReadStream } from 'fs';
import { StreamableFile } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

const EXPENSE_PAYMENT_METHODS = new Set(['cash', 'transfer', 'card']);

function parseExpensePaymentMethod(raw?: string | null): string | null {
  const v = String(raw ?? '').trim().toLowerCase();
  return EXPENSE_PAYMENT_METHODS.has(v) ? v : null;
}

function formatArMoney(value: number): string {
  const num = Number(value ?? 0);
  const abs = Math.abs(num).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return num < 0 ? `- $${abs}` : `$${abs}`;
}

export type MovementKindFilter = 'expense' | 'income' | 'transfer';
export type MovementSourceFilter = 'closing' | 'payment' | 'manual';
export type MovementPartyTypeFilter = 'supplier' | 'service' | 'employee';

export interface MovementFilters {
  from?: string;
  to?: string;
  fromAccountId?: string;
  toAccountId?: string;
  /** Cuenta origen o destino. */
  accountId?: string;
  conceptId?: string;
  closingId?: string;
  q?: string;
  kind?: MovementKindFilter;
  /** Solo gastos: cierre / pago / manual. */
  source?: MovementSourceFilter;
  /** Solo gastos vinculados a un pago. */
  partyType?: MovementPartyTypeFilter;
  /** true | false */
  invoiced?: string;
  /** Filtra el egreso ligado a un pago concreto. */
  paymentId?: string;
}

export interface UpsertMovementDto {
  businessDate: string;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  fromUserId?: string | null;
  toUserId?: string | null;
  description?: string | null;
  amountUyu: number;
  usdRate?: number | null;
  amountUsd?: number | null;
  conceptId?: string | null;
  invoiced?: boolean;
  invoiceNumber?: string | null;
  employeeId?: string | null;
  notifyAdmins?: boolean;
  notifyUserIds?: string[];
  /** cash | transfer | card · gastos */
  paymentMethod?: string | null;
  /** expense = gasto; income = ingreso; transfer = entre cuentas */
  kind?: MovementKindFilter;
}

type PaymentLink = {
  id: string;
  movementId: string | null;
  supplierId?: string | null;
  serviceId?: string | null;
  employeeId?: string | null;
};

@Injectable()
export class MovementsService implements OnModuleInit {
  constructor(
    @InjectRepository(Movement) private readonly movements: Repository<Movement>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(Concept) private readonly concepts: Repository<Concept>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly shops: ShopsService,
    private readonly catalogSeed: CatalogSeedService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    try {
      await this.movements.query(`
        ALTER TABLE movements
          MODIFY COLUMN fromAccountId VARCHAR(36) NULL,
          MODIFY COLUMN toAccountId VARCHAR(36) NULL
      `);
    } catch {
      // ya aplicado o motor distinto
    }
    for (const sql of [
      `ALTER TABLE movements ADD COLUMN fromUserId CHAR(36) NULL`,
      `ALTER TABLE movements ADD COLUMN toUserId CHAR(36) NULL`,
      `ALTER TABLE movements ADD COLUMN receiptFilePath VARCHAR(500) NULL`,
      `ALTER TABLE movements ADD COLUMN receiptFileName VARCHAR(255) NULL`,
      `ALTER TABLE movements ADD COLUMN receiptFileMime VARCHAR(120) NULL`,
      `ALTER TABLE movements ADD COLUMN paymentMethod VARCHAR(20) NULL`,
    ]) {
      try {
        await this.movements.query(sql);
      } catch {
        // ya existe
      }
    }
  }

  private toDto(m: Movement, payment?: PaymentLink | null) {
    const partyType = payment
      ? payment.supplierId
        ? 'supplier'
        : payment.serviceId
          ? 'service'
          : payment.employeeId
            ? 'employee'
            : null
      : null;
    const source = m.closingId ? 'closing' : payment ? 'payment' : 'manual';
    return {
      id: m.id,
      shopId: m.shopId,
      businessDate: m.businessDate,
      fromAccountId: m.fromAccountId,
      toAccountId: m.toAccountId,
      fromAccountName: m.fromAccount?.name ?? null,
      toAccountName: m.toAccount?.name ?? null,
      fromUserId: m.fromUserId ?? null,
      toUserId: m.toUserId ?? null,
      fromUserName: m.fromUser?.fullName ?? null,
      toUserName: m.toUser?.fullName ?? null,
      description: m.description ?? null,
      amountUyu: n(m.amountUyu),
      usdRate: m.usdRate != null ? n(m.usdRate) : null,
      amountUsd: m.amountUsd != null ? n(m.amountUsd) : null,
      conceptId: m.conceptId ?? null,
      conceptName: m.concept?.name ?? null,
      conceptKind: m.concept?.kind ?? null,
      invoiced: !!m.invoiced,
      invoiceNumber: m.invoiceNumber ?? null,
      closingId: m.closingId ?? null,
      employeeId: m.employeeId ?? null,
      source,
      paymentId: payment?.id ?? null,
      paymentPartyType: partyType,
      hasReceiptFile: !!m.receiptFilePath,
      receiptFileName: m.receiptFileName ?? null,
      paymentMethod: m.paymentMethod ?? null,
      active: !!m.active,
    };
  }


  private assertPerm(user: AuthUser, shopId: string, ...need: Permission[]) {
    const perms = resolveUserPermissions(user, shopId);
    if (!need.every((p) => perms.includes(p))) {
      throw new ForbiddenException('Sin permiso');
    }
  }

  private assertAnyPerm(user: AuthUser, shopId: string, ...need: Permission[]) {
    const perms = resolveUserPermissions(user, shopId);
    if (!need.some((p) => perms.includes(p))) {
      throw new ForbiddenException('Sin permiso');
    }
  }

  private isExpenseRow(r: {
    conceptKind?: string | null;
    toAccountName?: string | null;
    toAccountCode?: string | null;
  }): boolean {
    if (r.conceptKind === ConceptKind.EXPENSE || r.conceptKind === 'EXPENSE') return true;
    const name = (r.toAccountName ?? '').toLowerCase();
    const code = (r.toAccountCode ?? '').toUpperCase();
    return code === 'EGRESO' || name.includes('egreso');
  }

  private isIncomeRow(r: {
    conceptKind?: string | null;
    fromAccountName?: string | null;
    fromAccountCode?: string | null;
    toAccountName?: string | null;
    toAccountCode?: string | null;
  }): boolean {
    if (this.isExpenseRow(r)) return false;
    if (r.conceptKind === ConceptKind.INCOME || r.conceptKind === 'INCOME') return true;
    const name = (r.fromAccountName ?? '').toLowerCase();
    const code = (r.fromAccountCode ?? '').toUpperCase();
    return code === 'INGRESO' || name.includes('ingreso');
  }

  private classifyRow(r: {
    conceptKind?: string | null;
    fromAccountName?: string | null;
    fromAccountCode?: string | null;
    toAccountName?: string | null;
    toAccountCode?: string | null;
  }): MovementKindFilter {
    if (this.isExpenseRow(r)) return 'expense';
    if (this.isIncomeRow(r)) return 'income';
    return 'transfer';
  }

  private async findSystemAccount(shopId: string, code: 'INGRESO' | 'EGRESO') {
    const byCode = await this.accounts.findOne({ where: { shopId, code, active: true } });
    if (byCode) return byCode;
    const needle = code === 'INGRESO' ? 'ingreso' : 'egreso';
    const all = await this.accounts.find({ where: { shopId, active: true } });
    return all.find((a) => (a.name ?? '').toLowerCase().includes(needle)) ?? null;
  }

  async list(user: AuthUser, shopId: string, filters: MovementFilters = {}) {
    this.shops.assertShopAccess(user, shopId);
    if (filters.kind === 'expense') {
      this.assertPerm(user, shopId, 'expenses.read');
      await this.repairOrphanPaymentExpenses(user, shopId);
    } else if (filters.kind === 'income') {
      this.assertPerm(user, shopId, 'incomes.read');
    } else if (filters.kind === 'transfer') {
      this.assertPerm(user, shopId, 'accountTransfers.read');
    } else {
      this.assertAnyPerm(
        user,
        shopId,
        'expenses.read',
        'accountTransfers.read',
        'incomes.read',
        'movements.read',
      );
    }

    const qb = this.movements
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.fromAccount', 'fromAccount')
      .leftJoinAndSelect('m.toAccount', 'toAccount')
      .leftJoinAndSelect('m.fromUser', 'fromUser')
      .leftJoinAndSelect('m.toUser', 'toUser')
      .leftJoinAndSelect('m.concept', 'concept')
      .leftJoin(
        Payment,
        'pay',
        'pay.movementId = m.id AND pay.shopId = m.shopId AND pay.active = true',
      )
      .where('m.shopId = :shopId', { shopId })
      .andWhere('m.active = true');

    if (filters.from) qb.andWhere('m.businessDate >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('m.businessDate <= :to', { to: filters.to });
    if (filters.accountId) {
      qb.andWhere('(m.fromAccountId = :accountId OR m.toAccountId = :accountId)', {
        accountId: filters.accountId,
      });
    } else {
      if (filters.fromAccountId) {
        qb.andWhere('m.fromAccountId = :fromAccountId', {
          fromAccountId: filters.fromAccountId,
        });
      }
      if (filters.toAccountId) {
        qb.andWhere('m.toAccountId = :toAccountId', { toAccountId: filters.toAccountId });
      }
    }
    if (filters.conceptId) {
      qb.andWhere('m.conceptId = :conceptId', { conceptId: filters.conceptId });
    }
    if (filters.closingId) {
      qb.andWhere('m.closingId = :closingId', { closingId: filters.closingId });
    }
    if (filters.paymentId) {
      qb.andWhere('pay.id = :paymentId', { paymentId: filters.paymentId });
    }
    if (filters.q?.trim()) {
      qb.andWhere('m.description LIKE :q', { q: `%${filters.q.trim()}%` });
    }

    if (filters.kind === 'expense') {
      qb.andWhere(
        `(concept.kind = :expenseKind OR LOWER(toAccount.name) LIKE :egresoName OR UPPER(toAccount.code) = :egresoCode)`,
        { expenseKind: ConceptKind.EXPENSE, egresoName: '%egreso%', egresoCode: 'EGRESO' },
      );
      if (filters.source === 'closing') {
        qb.andWhere('m.closingId IS NOT NULL');
      } else if (filters.source === 'payment') {
        qb.andWhere('pay.id IS NOT NULL');
      } else if (filters.source === 'manual') {
        qb.andWhere('m.closingId IS NULL AND pay.id IS NULL');
      }
      if (filters.partyType === 'supplier') {
        qb.andWhere('pay.supplierId IS NOT NULL');
      } else if (filters.partyType === 'service') {
        qb.andWhere('pay.serviceId IS NOT NULL');
      } else if (filters.partyType === 'employee') {
        qb.andWhere('pay.employeeId IS NOT NULL');
      }
      if (filters.invoiced === 'true') {
        qb.andWhere('m.invoiced = true');
      } else if (filters.invoiced === 'false') {
        qb.andWhere('(m.invoiced = false OR m.invoiced IS NULL)');
      }
    } else if (filters.kind === 'income') {
      qb.andWhere(
        `(concept.kind = :incomeKind OR LOWER(fromAccount.name) LIKE :ingresoName OR UPPER(fromAccount.code) = :ingresoCode)`,
        { incomeKind: ConceptKind.INCOME, ingresoName: '%ingreso%', ingresoCode: 'INGRESO' },
      );
      qb.andWhere(
        `(concept.kind IS NULL OR concept.kind <> :expenseKind) AND (toAccount.id IS NULL OR (LOWER(toAccount.name) NOT LIKE :egresoName AND UPPER(COALESCE(toAccount.code, '')) <> :egresoCode))`,
        { expenseKind: ConceptKind.EXPENSE, egresoName: '%egreso%', egresoCode: 'EGRESO' },
      );
    } else if (filters.kind === 'transfer') {
      qb.andWhere(
        `(concept.kind IS NULL OR (concept.kind <> :expenseKind AND concept.kind <> :incomeKind))
         AND (toAccount.id IS NULL OR (LOWER(toAccount.name) NOT LIKE :egresoName AND UPPER(COALESCE(toAccount.code, '')) <> :egresoCode))
         AND (fromAccount.id IS NULL OR (LOWER(fromAccount.name) NOT LIKE :ingresoName AND UPPER(COALESCE(fromAccount.code, '')) <> :ingresoCode))`,
        {
          expenseKind: ConceptKind.EXPENSE,
          incomeKind: ConceptKind.INCOME,
          egresoName: '%egreso%',
          egresoCode: 'EGRESO',
          ingresoName: '%ingreso%',
          ingresoCode: 'INGRESO',
        },
      );
    }

    qb.distinct(true)
      .orderBy('m.businessDate', 'DESC')
      .addOrderBy('m.createdAt', 'DESC');
    const rows = await qb.getMany();
    const paymentLinks = await this.paymentLinksForMovements(
      shopId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => this.toDto(r, paymentLinks.get(r.id) ?? null));
  }

  /**
   * Pagos abonados sin egreso vivo (gasto borrado a mano): vuelve a crear el movimiento.
   */
  private async repairOrphanPaymentExpenses(user: AuthUser, shopId: string) {
    const orphans = await this.payments
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.supplier', 'supplier')
      .leftJoinAndSelect('p.service', 'service')
      .leftJoinAndSelect('p.employee', 'employee')
      .leftJoin(Movement, 'm', 'm.id = p.movementId AND m.deletedAt IS NULL')
      .where('p.shopId = :shopId', { shopId })
      .andWhere('p.active = true')
      .andWhere('p.status = :st', { st: PaymentStatus.PAID })
      .andWhere('(p.movementId IS NULL OR m.id IS NULL)')
      .take(40)
      .getMany();
    if (!orphans.length) return;

    const egreso = await this.accounts.findOne({
      where: { shopId, code: 'EGRESO', active: true },
    });
    if (!egreso) return;

    for (const p of orphans) {
      if (!p.accountId || !(n(p.amount) > 0)) continue;
      const paidAt = String(p.paidAt ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) continue;
      try {
        if (p.movementId) {
          await this.payments.update({ id: p.id, shopId }, { movementId: null });
        }
        let titleBit = (p.title || '').trim() || 'Sin concepto';
        if (p.conceptId) {
          const c = await this.concepts.findOne({
            where: { id: p.conceptId, shopId },
            select: ['name'],
          });
          if (c?.name) titleBit = c.name;
        }
        const payload = {
          businessDate: paidAt,
          fromAccountId: p.accountId,
          toAccountId: egreso.id,
          fromUserId: p.payerUserId ?? null,
          employeeId: p.employeeId ?? null,
          description: [
            `Pago: ${titleBit}`,
            p.supplier?.name ? `Proveedor: ${p.supplier.name}` : null,
            p.service?.name ? `Servicio: ${p.service.name}` : null,
            p.employee?.fullName ? `Empleado: ${p.employee.fullName}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          amountUyu: n(p.amount),
          conceptId: p.conceptId ?? null,
          invoiced: !!(p.invoiceNumber || p.invoiceFilePath),
          invoiceNumber: p.invoiceNumber ?? null,
          paymentMethod: p.paymentMethod ?? null,
        };
        let movement;
        try {
          movement = await this.create(user, shopId, payload, { fromPayment: true });
        } catch (err) {
          const msg = String((err as Error)?.message ?? err);
          if (p.payerUserId && /no pertenece al local/i.test(msg)) {
            movement = await this.create(
              user,
              shopId,
              { ...payload, fromUserId: null },
              { fromPayment: true },
            );
          } else {
            throw err;
          }
        }
        await this.payments.update({ id: p.id, shopId }, { movementId: movement.id });
      } catch {
        // no bloquear el listado
      }
    }
  }

  private async paymentLinksForMovements(
    shopId: string,
    movementIds: string[],
  ): Promise<Map<string, PaymentLink>> {
    const map = new Map<string, PaymentLink>();
    if (!movementIds.length) return map;
    const rows = await this.payments.find({
      where: { shopId, movementId: In(movementIds), active: true },
      select: ['id', 'movementId', 'supplierId', 'serviceId', 'employeeId'],
    });
    for (const p of rows) {
      if (!p.movementId) continue;
      map.set(p.movementId, {
        id: p.id,
        movementId: p.movementId,
        supplierId: p.supplierId ?? null,
        serviceId: p.serviceId ?? null,
        employeeId: p.employeeId ?? null,
      });
    }
    return map;
  }

  private async assertAccounts(
    shopId: string,
    fromId?: string | null,
    toId?: string | null,
  ) {
    if (fromId) {
      const from = await this.accounts.findOne({ where: { id: fromId, shopId } });
      if (!from || !isEntityActive(from.active)) {
        throw new BadRequestException('Cuenta origen inválida');
      }
    }
    if (toId) {
      const to = await this.accounts.findOne({ where: { id: toId, shopId } });
      if (!to || !isEntityActive(to.active)) {
        throw new BadRequestException('Cuenta destino inválida');
      }
    }
  }

  private normalizeAccountId(value?: string | null): string | null {
    const id = value?.trim();
    return id ? id : null;
  }

  private normalizeUserId(value?: string | null): string | null {
    const id = value?.trim();
    if (!id || id === '__local__') return null;
    return id;
  }

  private async assertShopUser(shopId: string, userId: string | null) {
    if (!userId) return;
    const link = await this.userShops.findOne({ where: { shopId, userId } });
    if (!link) throw new BadRequestException('Usuario no pertenece al local');
    const user = await this.users.findOne({ where: { id: userId, active: true } });
    if (!user) throw new BadRequestException('Usuario inválido');
  }

  async create(
    user: AuthUser,
    shopId: string,
    dto: UpsertMovementDto,
    opts?: { fromPayment?: boolean },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const kind = dto.kind;
    // El flujo de pagos ya autorizó el abono: no exige expenses.manage al pagador.
    if (!opts?.fromPayment) {
      if (kind === 'expense') {
        this.assertPerm(user, shopId, 'expenses.manage');
      } else if (kind === 'income') {
        this.assertPerm(user, shopId, 'incomes.manage');
      } else if (kind === 'transfer') {
        this.assertPerm(user, shopId, 'accountTransfers.manage');
      } else {
        this.assertAnyPerm(
          user,
          shopId,
          'expenses.manage',
          'accountTransfers.manage',
          'incomes.manage',
          'movements.manage',
        );
      }
    }

    let conceptId = dto.conceptId ?? null;
    let fromAccountId = this.normalizeAccountId(dto.fromAccountId);
    let toAccountId = this.normalizeAccountId(dto.toAccountId);
    const fromUserId = this.normalizeUserId(dto.fromUserId);
    const toUserId = this.normalizeUserId(dto.toUserId);

    if (kind === 'income' && !fromAccountId) {
      const ingreso = await this.findSystemAccount(shopId, 'INGRESO');
      if (!ingreso) throw new BadRequestException('Falta la cuenta de Ingreso del local');
      fromAccountId = ingreso.id;
    }
    if (kind === 'expense' && !toAccountId) {
      const egreso = await this.findSystemAccount(shopId, 'EGRESO');
      if (!egreso) throw new BadRequestException('Falta la cuenta de Egreso del local');
      toAccountId = egreso.id;
    }

    if (kind === 'transfer') {
      if (!fromAccountId || !toAccountId) {
        throw new BadRequestException('La transferencia requiere cuenta origen y destino');
      }
      if (fromAccountId === toAccountId) {
        throw new BadRequestException('Origen y destino deben ser distintos');
      }
    }
    if (kind === 'expense' && !conceptId) {
      throw new BadRequestException('El gasto requiere un concepto');
    }
    if (kind === 'income') {
      if (!conceptId) throw new BadRequestException('El ingreso requiere un concepto');
      if (!toAccountId) throw new BadRequestException('El ingreso requiere cuenta destino');
    }

    let paymentMethod: string | null = null;
    if (dto.paymentMethod !== undefined) {
      paymentMethod = parseExpensePaymentMethod(dto.paymentMethod);
      if (dto.paymentMethod && !paymentMethod) {
        throw new BadRequestException('Forma de pago inválida');
      }
    }
    if (kind === 'expense' && !opts?.fromPayment) {
      if (!paymentMethod) {
        throw new BadRequestException('El gasto requiere forma de pago');
      }
    }

    await this.assertAccounts(shopId, fromAccountId, toAccountId);
    await this.assertShopUser(shopId, fromUserId);
    await this.assertShopUser(shopId, toUserId);
    if (conceptId) {
      const c = await this.concepts.findOne({
        where: { id: conceptId, shopId, active: true },
      });
      if (!c) throw new BadRequestException('Concepto inválido');
      if (kind === 'expense' && c.kind !== ConceptKind.EXPENSE) {
        throw new BadRequestException('El concepto debe ser de tipo egreso');
      }
      if (kind === 'income' && c.kind !== ConceptKind.INCOME) {
        throw new BadRequestException('El concepto debe ser de tipo ingreso');
      }
    }
    const amountUsd =
      dto.amountUsd != null
        ? dto.amountUsd
        : dto.usdRate && dto.amountUyu
          ? dto.amountUyu / dto.usdRate
          : null;

    const row = await this.movements.save(
      this.movements.create({
        shopId,
        businessDate: dto.businessDate,
        fromAccountId,
        toAccountId,
        fromUserId,
        toUserId,
        description: dto.description?.trim() || null,
        amountUyu: money(n(dto.amountUyu)),
        usdRate: dto.usdRate != null ? String(dto.usdRate) : null,
        amountUsd: amountUsd != null ? String(amountUsd) : null,
        conceptId,
        invoiced: dto.invoiced ?? false,
        invoiceNumber: dto.invoiceNumber ?? null,
        employeeId: dto.employeeId ?? null,
        paymentMethod,
        closingId: null,
        active: true,
      }),
    );
    const created = await this.one(user, shopId, row.id);
    if (dto.notifyAdmins) {
      void this.notifyAdminsMovementCreated(user, shopId, created).catch(() => undefined);
    }
    return created;
  }

  async uploadReceiptFile(
    user: AuthUser,
    shopId: string,
    id: string,
    file: Express.Multer.File,
  ) {
    this.shops.assertShopAccess(user, shopId);
    this.assertPerm(user, shopId, 'expenses.manage');
    const row = await this.movements.findOne({ where: { id, shopId } });
    if (!row || !isEntityActive(row.active)) {
      throw new NotFoundException('Movimiento no encontrado');
    }
    if (!file?.buffer?.length) throw new BadRequestException('Archivo requerido');
    deleteUploadIfExists(row.receiptFilePath);
    const saved = saveUploadFile({
      relativeDir: `movements/${shopId}/${id}`,
      basename: 'receipt',
      buffer: file.buffer,
      originalName: file.originalname,
      mime: file.mimetype,
    });
    row.receiptFilePath = saved.relativePath;
    row.receiptFileName = file.originalname || saved.fileName;
    row.receiptFileMime = file.mimetype || null;
    await this.movements.save(row);
    return this.one(user, shopId, id);
  }

  async downloadReceiptFile(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.movements.findOne({ where: { id, shopId } });
    if (!row || !isEntityActive(row.active)) {
      throw new NotFoundException('Movimiento no encontrado');
    }
    const abs = resolveUploadPath(row.receiptFilePath);
    if (!abs) throw new NotFoundException('Comprobante no encontrado');
    return {
      stream: new StreamableFile(createReadStream(abs)),
      fileName: row.receiptFileName || 'comprobante.pdf',
      mime: row.receiptFileMime || 'application/octet-stream',
    };
  }

  async one(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.movements.findOne({
      where: { id, shopId },
      relations: ['fromAccount', 'toAccount', 'fromUser', 'toUser', 'concept'],
    });
    if (!row) throw new NotFoundException('Movimiento no encontrado');
    const paymentLinks = await this.paymentLinksForMovements(shopId, [row.id]);
    return this.toDto(row, paymentLinks.get(row.id) ?? null);
  }

  async update(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: Partial<UpsertMovementDto>,
    opts?: { fromPayment?: boolean },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.movements.findOne({
      where: { id, shopId },
      relations: ['fromAccount', 'toAccount', 'concept'],
    });
    if (!row) throw new NotFoundException('Movimiento no encontrado');
    if (row.closingId && !isGlobalAdmin(user.globalRole as GlobalRole)) {
      throw new BadRequestException(
        'Este movimiento fue generado por un cierre; editá el cierre',
      );
    }

    const asExpense = this.isExpenseRow({
      conceptKind: row.concept?.kind,
      toAccountName: row.toAccount?.name,
      toAccountCode: row.toAccount?.code,
    });
    const asIncome = this.isIncomeRow({
      conceptKind: row.concept?.kind,
      fromAccountName: row.fromAccount?.name,
      fromAccountCode: row.fromAccount?.code,
      toAccountName: row.toAccount?.name,
      toAccountCode: row.toAccount?.code,
    });
    if (!opts?.fromPayment) {
      if (asExpense) {
        if (!canEditExpenses(user, shopId)) {
          throw new ForbiddenException('No tenés permiso para editar gastos');
        }
      } else if (asIncome) {
        this.assertPerm(user, shopId, 'incomes.manage');
      } else this.assertPerm(user, shopId, 'accountTransfers.manage');
    }

    const kind = dto.kind ?? this.classifyRow({
      conceptKind: row.concept?.kind,
      fromAccountName: row.fromAccount?.name,
      fromAccountCode: row.fromAccount?.code,
      toAccountName: row.toAccount?.name,
      toAccountCode: row.toAccount?.code,
    });

    const fromId =
      dto.fromAccountId !== undefined
        ? this.normalizeAccountId(dto.fromAccountId)
        : row.fromAccountId;
    const toId =
      dto.toAccountId !== undefined
        ? this.normalizeAccountId(dto.toAccountId)
        : row.toAccountId;
    await this.assertAccounts(shopId, fromId, toId);

    if (dto.fromUserId !== undefined) {
      const fromUserId = this.normalizeUserId(dto.fromUserId);
      await this.assertShopUser(shopId, fromUserId);
      row.fromUserId = fromUserId;
    }
    if (dto.toUserId !== undefined) {
      const toUserId = this.normalizeUserId(dto.toUserId);
      await this.assertShopUser(shopId, toUserId);
      row.toUserId = toUserId;
    }

    if (dto.businessDate !== undefined) row.businessDate = dto.businessDate;
    if (dto.fromAccountId !== undefined) row.fromAccountId = fromId;
    if (dto.toAccountId !== undefined) row.toAccountId = toId;
    if (dto.description !== undefined) row.description = dto.description?.trim() || null;
    if (dto.amountUyu !== undefined) row.amountUyu = money(n(dto.amountUyu));
    if (dto.usdRate !== undefined) {
      row.usdRate = dto.usdRate != null ? String(dto.usdRate) : null;
    }
    if (dto.amountUsd !== undefined) {
      row.amountUsd = dto.amountUsd != null ? String(dto.amountUsd) : null;
    } else if (dto.usdRate != null && dto.amountUyu != null) {
      row.amountUsd = String(dto.amountUyu / dto.usdRate);
    }

    if (kind === 'transfer') {
      if (!fromId || !toId) {
        throw new BadRequestException('La transferencia requiere cuenta origen y destino');
      }
    } else if (dto.conceptId !== undefined) {
      if (!dto.conceptId) {
        throw new BadRequestException(
          kind === 'income' ? 'El ingreso requiere un concepto' : 'El gasto requiere un concepto',
        );
      }
      const c = await this.concepts.findOne({
        where: { id: dto.conceptId, shopId, active: true },
      });
      if (!c) throw new BadRequestException('Concepto inválido');
      row.conceptId = dto.conceptId;
    }

    if (dto.invoiced !== undefined) row.invoiced = dto.invoiced;
    if (dto.invoiceNumber !== undefined) row.invoiceNumber = dto.invoiceNumber;
    if (dto.employeeId !== undefined) row.employeeId = dto.employeeId;
    if (dto.paymentMethod !== undefined) {
      const paymentMethod = parseExpensePaymentMethod(dto.paymentMethod);
      if (dto.paymentMethod && !paymentMethod) {
        throw new BadRequestException('Forma de pago inválida');
      }
      if (kind === 'expense' && !opts?.fromPayment && !paymentMethod) {
        throw new BadRequestException('El gasto requiere forma de pago');
      }
      row.paymentMethod = paymentMethod;
    }

    await this.movements.save(row);
    if (!opts?.fromPayment) {
      await this.syncLinkedPayment(shopId, row);
    }
    const saved = await this.one(user, shopId, id);
    if (asExpense || asIncome) {
      await this.notifyMovementChange(
        user,
        shopId,
        NotificationType.MOVEMENT_UPDATED,
        asIncome ? 'Ingreso editado' : 'Gasto editado',
        saved,
        dto,
      );
    }
    return saved;
  }

  async remove(
    user: AuthUser,
    shopId: string,
    id: string,
    opts?: { fromPayment?: boolean; notifyAdmins?: boolean; notifyUserIds?: string[] },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.movements.findOne({
      where: { id, shopId },
      relations: ['fromAccount', 'toAccount', 'concept'],
    });
    if (!row) throw new NotFoundException('Movimiento no encontrado');
    if (row.closingId && !isGlobalAdmin(user.globalRole as GlobalRole)) {
      throw new BadRequestException(
        'Este movimiento fue generado por un cierre; editá el cierre',
      );
    }
    const linkedPayment = await this.payments.findOne({
      where: { shopId, movementId: id, active: true },
      select: ['id'],
    });
    if (linkedPayment && !opts?.fromPayment) {
      throw new BadRequestException(
        'Este gasto viene de un pago abonado. Para sacarlo, revertí el pago en Pagos (de Abonado a Validado).',
      );
    }
    const asExpense = this.isExpenseRow({
      conceptKind: row.concept?.kind,
      toAccountName: row.toAccount?.name,
      toAccountCode: row.toAccount?.code,
    });
    const asIncome = this.isIncomeRow({
      conceptKind: row.concept?.kind,
      fromAccountName: row.fromAccount?.name,
      fromAccountCode: row.fromAccount?.code,
      toAccountName: row.toAccount?.name,
      toAccountCode: row.toAccount?.code,
    });
    if (!opts?.fromPayment) {
      if (asExpense) {
        if (!canEditExpenses(user, shopId)) {
          throw new ForbiddenException('No tenés permiso para borrar gastos');
        }
      } else if (asIncome) {
        this.assertPerm(user, shopId, 'incomes.manage');
      } else this.assertPerm(user, shopId, 'accountTransfers.manage');
    }
    if ((asExpense || asIncome) && !opts?.fromPayment) {
      await this.notifyMovementChange(
        user,
        shopId,
        NotificationType.MOVEMENT_DELETED,
        asIncome ? 'Ingreso eliminado' : 'Gasto eliminado',
        {
          businessDate: String(row.businessDate ?? ''),
          amountUyu: n(row.amountUyu),
          fromAccountName: row.fromAccount?.name ?? null,
          toAccountName: row.toAccount?.name ?? null,
          conceptName: row.concept?.name ?? null,
          description: row.description,
        },
        opts,
      );
    }
    await this.movements.softRemove(row);
    return { ok: true };
  }

  /** true si el movimiento existe y no está borrado. */
  async isLive(shopId: string, id: string): Promise<boolean> {
    const row = await this.movements.findOne({
      where: { id, shopId },
      select: ['id'],
    });
    return !!row;
  }

  async expensesByConcept(user: AuthUser, shopId: string, filters: MovementFilters = {}) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.list(user, shopId, filters);
    const expenseRows = rows.filter(
      (r) => r.conceptKind === 'EXPENSE' || r.toAccountName === '2. Egreso',
    );
    const map = new Map<string, { conceptId: string | null; conceptName: string; total: number }>();
    for (const r of expenseRows) {
      const key = r.conceptId ?? r.conceptName ?? 'Sin concepto';
      const cur = map.get(key) ?? {
        conceptId: r.conceptId,
        conceptName: r.conceptName ?? 'Sin concepto',
        total: 0,
      };
      cur.total += r.amountUyu;
      map.set(key, cur);
    }
    const items = [...map.values()].sort((a, b) => b.total - a.total);
    const sum = items.reduce((s, i) => s + i.total, 0);
    return {
      shopId,
      from: filters.from ?? null,
      to: filters.to ?? null,
      total: sum,
      items: items.map((i) => ({
        ...i,
        share: sum > 0 ? i.total / sum : 0,
      })),
    };
  }

  async balances(user: AuthUser, shopId: string, filters: MovementFilters = {}) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.list(user, shopId, filters);
    // Socios + canales del local (PVS, MP, efectivo, etc.). Sin SYSTEM (INGRESO/EGRESO).
    const accounts = await this.accounts.find({
      where: [
        { shopId, active: true, type: LedgerAccountType.PARTNER },
        { shopId, active: true, type: LedgerAccountType.CHANNEL },
      ],
      order: { type: 'ASC', name: 'ASC' },
    });
    const bal = new Map<
      string,
      {
        accountId: string;
        name: string;
        type: string;
        income: number;
        expense: number;
        opening: number;
      }
    >();
    for (const a of accounts) {
      bal.set(a.id, {
        accountId: a.id,
        name: a.name,
        type: a.type,
        income: 0,
        expense: 0,
        opening: Number(a.openingBalance ?? 0),
      });
    }
    for (const r of rows) {
      if (r.fromAccountId) {
        const from = bal.get(r.fromAccountId);
        if (from) from.expense += r.amountUyu;
      }
      if (r.toAccountId) {
        const to = bal.get(r.toAccountId);
        if (to) to.income += r.amountUyu;
      }
    }
    // Canales del local primero, luego socios.
    const ordered = [...bal.values()].sort((a, b) => {
      const rank = (t: string) => (t === LedgerAccountType.CHANNEL ? 0 : 1);
      const d = rank(a.type) - rank(b.type);
      if (d !== 0) return d;
      return a.name.localeCompare(b.name, 'es');
    });
    return {
      shopId,
      from: filters.from ?? null,
      to: filters.to ?? null,
      accounts: ordered.map((a) => ({
        accountId: a.accountId,
        name: a.name,
        type: a.type,
        income: a.income,
        expense: a.expense,
        openingBalance: a.opening,
        balance: a.income - a.expense + a.opening,
      })),
    };
  }

  async exportBalancesXlsx(user: AuthUser, shopId: string, filters: MovementFilters = {}) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.getShopEntity(shopId);
    const data = await this.balances(user, shopId, filters);
    const accounts = data.accounts ?? [];
    const total = accounts.reduce((sum, a) => sum + Number(a.balance ?? 0), 0);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';
    wb.created = new Date();
    const ws = wb.addWorksheet('Saldos');
    ws.getColumn(1).width = 28;
    ws.getColumn(2).width = 18;

    ws.mergeCells('A1:B1');
    const title = ws.getCell('A1');
    title.value = 'SALDOS';
    title.font = { bold: true, size: 14 };
    title.alignment = { horizontal: 'left', vertical: 'middle' };
    title.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    };
    ws.getCell('B1').border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    };
    ws.getRow(1).height = 22;

    const header = ws.getRow(2);
    header.values = ['Cuenta', 'Saldo'];
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE7E7E7' },
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
    });

    const thin = {
      top: { style: 'thin' as const, color: { argb: 'FF000000' } },
      left: { style: 'thin' as const, color: { argb: 'FF000000' } },
      bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
      right: { style: 'thin' as const, color: { argb: 'FF000000' } },
    };

    let rowIdx = 3;
    for (const a of accounts) {
      const row = ws.getRow(rowIdx);
      row.getCell(1).value = a.name;
      row.getCell(2).value = formatArMoney(a.balance);
      row.getCell(1).alignment = { horizontal: 'left' };
      row.getCell(2).alignment = { horizontal: 'right' };
      row.getCell(1).border = thin;
      row.getCell(2).border = thin;
      rowIdx += 1;
    }

    const totalRow = ws.getRow(rowIdx);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = formatArMoney(total);
    totalRow.font = { bold: true };
    totalRow.getCell(1).alignment = { horizontal: 'left' };
    totalRow.getCell(2).alignment = { horizontal: 'right' };
    const thickTop = {
      top: { style: 'medium' as const, color: { argb: 'FF000000' } },
      left: { style: 'thin' as const, color: { argb: 'FF000000' } },
      bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
      right: { style: 'thin' as const, color: { argb: 'FF000000' } },
    };
    totalRow.getCell(1).border = thickTop;
    totalRow.getCell(2).border = thickTop;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const slug = String(shop?.slug || shopId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      buffer,
      filename: `saldos-${slug || 'local'}-${stamp}.xlsx`,
    };
  }

  private async notifyMovementChange(
    actor: AuthUser,
    shopId: string,
    type: NotificationType,
    title: string,
    movement: {
      id?: string;
      businessDate?: string;
      amountUyu?: number;
      fromAccountName?: string | null;
      toAccountName?: string | null;
      conceptName?: string | null;
      description?: string | null;
    },
    opts?: { notifyAdmins?: boolean; notifyUserIds?: string[] | null },
  ) {
    if (!opts?.notifyAdmins && !opts?.notifyUserIds?.length) return;
    const recipientIds = await this.shops.resolveNotifyUserIds(shopId, actor.id, opts);
    if (!recipientIds.length) return;
    const shop = await this.shops.findOne(actor, shopId);
    const shopName = shop?.name?.trim() || 'Local';
    const date = String(movement.businessDate || '').slice(0, 10);
    const amount = formatArMoney(Number(movement.amountUyu || 0));
    const fromName = (movement.fromAccountName ?? '').trim();
    const toName = (movement.toAccountName ?? '').trim();
    const route =
      fromName && toName ? `${fromName} → ${toName}` : fromName || toName || null;
    const body = [
      shopName,
      date,
      amount,
      route,
      movement.conceptName?.trim() || null,
      movement.description?.trim() || null,
      `por ${actor.fullName || actor.email}`,
    ]
      .filter(Boolean)
      .join(' · ');
    await this.notifications.createMany(
      recipientIds.map((userId) => ({
        userId,
        shopId,
        type,
        title,
        body,
        targetId: type === NotificationType.MOVEMENT_DELETED ? null : movement.id ?? null,
      })),
    );
  }

  private async notifyAdminsMovementCreated(
    actor: AuthUser,
    shopId: string,
    movement: {
      id: string;
      businessDate: string;
      amountUyu: number;
      fromAccountName?: string | null;
      toAccountName?: string | null;
      conceptName?: string | null;
      description?: string | null;
    },
  ) {
    const shop = await this.shops.findOne(actor, shopId);
    const shopName = shop?.name?.trim() || 'Local';
    const links = await this.userShops.find({
      where: {
        shopId,
        shopRole: In([GlobalRole.OWNER, GlobalRole.ADMIN]),
      },
    });
    const recipientIds = new Set(links.map((l) => l.userId));
    const globalOwners = await this.users.find({
      where: { globalRole: GlobalRole.OWNER },
      select: ['id', 'active'],
    });
    for (const u of globalOwners) {
      if (isEntityActive(u.active)) recipientIds.add(u.id);
    }
    recipientIds.delete(actor.id);
    if (!recipientIds.size) return;

    const date = String(movement.businessDate || '').slice(0, 10);
    const amount = formatArMoney(Number(movement.amountUyu || 0));
    const fromName = (movement.fromAccountName ?? '').trim();
    const toName = (movement.toAccountName ?? '').trim();
    const route =
      fromName && toName ? `${fromName} → ${toName}` : fromName || toName || null;
    const title = 'Nuevo movimiento';
    const body = [
      shopName,
      date,
      amount,
      route,
      movement.conceptName?.trim() || null,
      movement.description?.trim() || null,
      `por ${actor.fullName || actor.email}`,
    ]
      .filter(Boolean)
      .join(' · ');

    await this.notifications.createMany(
      [...recipientIds].map((userId) => ({
        userId,
        shopId,
        type: NotificationType.MOVEMENT_CREATED,
        title,
        body,
        targetId: movement.id,
      })),
    );
  }

  /** Si el gasto nació de un pago, replica monto, cuenta, concepto y fecha. */
  private async syncLinkedPayment(shopId: string, row: Movement) {
    const payment = await this.payments.findOne({
      where: { shopId, movementId: row.id, active: true },
    });
    if (!payment || payment.status !== PaymentStatus.PAID) return;
    await this.payments
      .createQueryBuilder()
      .update(Payment)
      .set({
        amount: money(n(row.amountUyu)),
        accountId: row.fromAccountId ?? payment.accountId,
        conceptId: row.conceptId ?? payment.conceptId,
        notes: row.description ?? payment.notes,
        paidAt: String(row.businessDate ?? payment.paidAt ?? '').slice(0, 10) || payment.paidAt,
        paymentMethod: (row.paymentMethod as Payment['paymentMethod']) ?? payment.paymentMethod,
      })
      .where('id = :id AND shopId = :shopId', { id: payment.id, shopId })
      .execute();
  }
}