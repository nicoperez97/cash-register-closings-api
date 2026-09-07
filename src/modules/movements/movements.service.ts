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
import { LedgerAccountUser } from '../../entities/ledger-account-user.entity';
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
import { accountCommissionOf } from '../../common/account-commission';
import { formatMoney } from '../../common/format-money';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

const EXPENSE_PAYMENT_METHODS = new Set(['cash', 'transfer', 'card']);

function parseExpensePaymentMethod(raw?: string | null): string | null {
  const v = String(raw ?? '').trim().toLowerCase();
  return EXPENSE_PAYMENT_METHODS.has(v) ? v : null;
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
  paymentMethod?: string;
  employeeId?: string;
  /** true | false */
  hasReceipt?: string;
  shiftId?: string;
  /** panel (default) | all */
  scope?: 'panel' | 'all';
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
  /** Si true, el destino es la cuenta Dividendos del local. */
  isDividend?: boolean;
  /**
   * Socio beneficiario del dividendo (opcional).
   * No recibe el monto en su saldo: solo queda anotado; el dinero va a Dividendos.
   */
  beneficiaryAccountId?: string | null;
}

type PaymentLink = {
  id: string;
  movementId: string | null;
  supplierId?: string | null;
  serviceId?: string | null;
  employeeId?: string | null;
  isDividend?: boolean;
  toAccountId?: string | null;
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
    @InjectRepository(LedgerAccountUser)
    private readonly accountLinks: Repository<LedgerAccountUser>,
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
      `ALTER TABLE movements ADD COLUMN beneficiaryAccountId CHAR(36) NULL`,
      `ALTER TABLE movements MODIFY COLUMN amountUyu DECIMAL(20,2) NOT NULL DEFAULT 0`,
    ]) {
      try {
        await this.movements.query(sql);
      } catch {
        // ya existe
      }
    }
    for (const sql of [
      `ALTER TABLE payments MODIFY COLUMN amount DECIMAL(20,2) NULL`,
      `ALTER TABLE partner_split_runs MODIFY COLUMN distributedAmount DECIMAL(20,2) NOT NULL DEFAULT 0`,
      `ALTER TABLE ledger_accounts MODIFY COLUMN openingBalance DECIMAL(20,2) NOT NULL DEFAULT 0`,
    ]) {
      try {
        await this.movements.query(sql);
      } catch {
        // ya aplicado
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
    const toType = m.toAccount?.type ?? null;
    const isDividend =
      !!payment?.isDividend || toType === LedgerAccountType.DIVIDENDS;
    const beneficiaryAccountId =
      m.beneficiaryAccountId ??
      (payment?.isDividend ? (payment.toAccountId ?? null) : null);
    return {
      id: m.id,
      shopId: m.shopId,
      businessDate: m.businessDate,
      fromAccountId: m.fromAccountId,
      toAccountId: m.toAccountId,
      fromAccountName: m.fromAccount?.name ?? null,
      toAccountName: m.toAccount?.name ?? null,
      toAccountType: toType,
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
      isDividend,
      beneficiaryAccountId,
      hasReceiptFile: !!m.receiptFilePath,
      receiptFileName: m.receiptFileName ?? null,
      paymentMethod: m.paymentMethod ?? null,
      active: !!m.active,
    };
  }

  /**
   * Completa beneficiaryAccountId en dividendos viejos (solo toUserId o texto "→ Nombre").
   */
  private async enrichDividendBeneficiaries(
    shopId: string,
    dtos: Array<{ isDividend?: boolean; beneficiaryAccountId?: string | null; description?: string | null }>,
    rows: Movement[],
  ) {
    const needIdx: number[] = [];
    for (let i = 0; i < dtos.length; i++) {
      if (dtos[i].isDividend && !dtos[i].beneficiaryAccountId) needIdx.push(i);
    }
    if (!needIdx.length) return;

    const userIds = [
      ...new Set(
        needIdx
          .map((i) => rows[i].toUserId)
          .filter((id): id is string => !!id),
      ),
    ];
    const byUser = new Map<string, string>();
    if (userIds.length) {
      const links = await this.accountLinks.find({
        where: { shopId, userId: In(userIds) },
        relations: ['account'],
      });
      for (const link of links) {
        if (
          link.account?.type === LedgerAccountType.PARTNER &&
          link.account.active !== false &&
          !byUser.has(link.userId)
        ) {
          byUser.set(link.userId, link.accountId);
        }
      }
    }

    const needNames = needIdx.filter(
      (i) => !rows[i].toUserId || !byUser.has(rows[i].toUserId!),
    );
    let partnersByName: Map<string, string> | null = null;
    if (needNames.length) {
      const partners = await this.accounts.find({
        where: { shopId, active: true, type: LedgerAccountType.PARTNER },
      });
      partnersByName = new Map(
        partners.map((p) => [(p.name ?? '').trim().toLowerCase(), p.id]),
      );
    }

    for (const i of needIdx) {
      const row = rows[i];
      if (row.toUserId && byUser.has(row.toUserId)) {
        dtos[i].beneficiaryAccountId = byUser.get(row.toUserId)!;
        continue;
      }
      const arrow = (row.description ?? dtos[i].description ?? '').match(/→\s*(.+?)\s*$/u);
      const name = arrow?.[1]?.trim().toLowerCase();
      if (name && partnersByName?.has(name)) {
        dtos[i].beneficiaryAccountId = partnersByName.get(name)!;
      }
    }
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
    if (filters.paymentMethod) {
      qb.andWhere('m.paymentMethod = :paymentMethod', {
        paymentMethod: filters.paymentMethod,
      });
    }
    if (filters.employeeId) {
      qb.andWhere('m.employeeId = :employeeId', { employeeId: filters.employeeId });
    }
    if (filters.hasReceipt === 'true') {
      qb.andWhere('m.receiptFilePath IS NOT NULL AND m.receiptFilePath <> :emptyReceipt', {
        emptyReceipt: '',
      });
    } else if (filters.hasReceipt === 'false') {
      qb.andWhere('(m.receiptFilePath IS NULL OR m.receiptFilePath = :emptyReceipt)', {
        emptyReceipt: '',
      });
    }
    if (filters.shiftId) {
      qb.leftJoin('m.closing', 'closingForShift');
      qb.andWhere('closingForShift.shiftId = :shiftId', { shiftId: filters.shiftId });
    }

    if (filters.kind === 'expense') {
      qb.andWhere(
        `(concept.kind = :expenseKind OR LOWER(toAccount.name) LIKE :egresoName OR UPPER(toAccount.code) = :egresoCode)`,
        { expenseKind: ConceptKind.EXPENSE, egresoName: '%egreso%', egresoCode: 'EGRESO' },
      );
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
      .addOrderBy('m.createdAt', 'DESC')
      .take(2500);
    const rows = await qb.getMany();
    const paymentLinks = await this.paymentLinksForMovements(
      shopId,
      rows.map((r) => r.id),
    );
    const dtos = rows.map((r) => this.toDto(r, paymentLinks.get(r.id) ?? null));
    await this.enrichDividendBeneficiaries(shopId, dtos, rows);
    return dtos;
  }

  /**
   * Filas livianas para reportes (sin usuarios, pagos ni tope de UI).
   */
  async listAnalytics(
    user: AuthUser,
    shopId: string,
    filters: Pick<MovementFilters, 'from' | 'to' | 'kind'> = {},
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (filters.kind === 'expense') {
      this.assertPerm(user, shopId, 'expenses.read');
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
      .leftJoinAndSelect('m.concept', 'concept')
      .where('m.shopId = :shopId', { shopId })
      .andWhere('m.active = true');
    if (filters.from) qb.andWhere('m.businessDate >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('m.businessDate <= :to', { to: filters.to });
    if (filters.kind === 'expense') {
      qb.andWhere(
        `(concept.kind = :expenseKind OR LOWER(toAccount.name) LIKE :egresoName OR UPPER(toAccount.code) = :egresoCode)`,
        { expenseKind: ConceptKind.EXPENSE, egresoName: '%egreso%', egresoCode: 'EGRESO' },
      );
    } else if (filters.kind === 'income') {
      qb.andWhere(
        `(concept.kind = :incomeKind OR LOWER(fromAccount.name) LIKE :ingresoName OR UPPER(fromAccount.code) = :ingresoCode)`,
        { incomeKind: ConceptKind.INCOME, ingresoName: '%ingreso%', ingresoCode: 'INGRESO' },
      );
    } else if (filters.kind === 'transfer') {
      qb.andWhere(
        `(concept.kind IS NULL OR (concept.kind <> :expenseKind AND concept.kind <> :incomeKind))`,
        { expenseKind: ConceptKind.EXPENSE, incomeKind: ConceptKind.INCOME },
      );
    }
    qb.orderBy('m.businessDate', 'ASC');
    const rows = await qb.getMany();
    return rows.map((m) => ({
      id: m.id,
      businessDate: m.businessDate,
      amountUyu: n(m.amountUyu),
      conceptId: m.conceptId ?? null,
      conceptName: m.concept?.name ?? null,
      conceptKind: m.concept?.kind ?? null,
      fromAccountName: m.fromAccount?.name ?? null,
      toAccountName: m.toAccount?.name ?? null,
    }));
  }

  private async paymentLinksForMovements(
    shopId: string,
    movementIds: string[],
  ): Promise<Map<string, PaymentLink>> {
    const map = new Map<string, PaymentLink>();
    if (!movementIds.length) return map;
    const rows = await this.payments.find({
      where: { shopId, movementId: In(movementIds), active: true },
      select: [
        'id',
        'movementId',
        'supplierId',
        'serviceId',
        'employeeId',
        'isDividend',
        'toAccountId',
      ],
    });
    for (const p of rows) {
      if (!p.movementId) continue;
      map.set(p.movementId, {
        id: p.id,
        movementId: p.movementId,
        supplierId: p.supplierId ?? null,
        serviceId: p.serviceId ?? null,
        employeeId: p.employeeId ?? null,
        isDividend: !!p.isDividend,
        toAccountId: p.toAccountId ?? null,
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
    opts?: { fromPayment?: boolean; closingId?: string | null },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const kind = dto.isDividend ? 'transfer' : dto.kind;

    let conceptId = dto.conceptId ?? null;
    let fromAccountId = this.normalizeAccountId(dto.fromAccountId);
    let toAccountId = this.normalizeAccountId(dto.toAccountId);
    const fromUserId = this.normalizeUserId(dto.fromUserId);
    let toUserId = this.normalizeUserId(dto.toUserId);

    // Permisos: transferencias normales requieren manage; dividendo propio puede el dueño de la cuenta socio.
    // El flujo de pagos ya autorizó el abono: no exige expenses.manage al pagador.
    if (!opts?.fromPayment) {
      if (kind === 'expense') {
        this.assertPerm(user, shopId, 'expenses.manage');
      } else if (kind === 'income') {
        this.assertPerm(user, shopId, 'incomes.manage');
      } else if (kind === 'transfer') {
        const ownDividend =
          !!dto.isDividend &&
          !!fromAccountId &&
          (await this.userOwnsPartnerAccount(shopId, user.id, fromAccountId));
        if (!ownDividend) {
          this.assertPerm(user, shopId, 'accountTransfers.manage');
        }
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

    let dividendFromName: string | null = null;
    let dividendToName: string | null = null;
    let beneficiaryAccountId: string | null = null;
    if (kind === 'transfer') {
      if (dto.isDividend) {
        const dividends = await this.catalogSeed.ensureDividendsAccount(shopId);
        toAccountId = dividends.id;
      }
      if (!fromAccountId || !toAccountId) {
        throw new BadRequestException('La transferencia requiere cuenta origen y destino');
      }
      if (fromAccountId === toAccountId) {
        throw new BadRequestException('Origen y destino deben ser distintos');
      }
      if (dto.isDividend) {
        const from = await this.accounts.findOne({
          where: { id: fromAccountId, shopId, active: true },
        });
        if (!from || from.type !== LedgerAccountType.PARTNER) {
          throw new BadRequestException('El dividendo debe salir de una cuenta de socio');
        }
        dividendFromName = from.name;
        const beneficiaryId = this.normalizeAccountId(dto.beneficiaryAccountId);
        if (beneficiaryId) {
          if (beneficiaryId === fromAccountId) {
            throw new BadRequestException(
              'El beneficiario del dividendo debe ser otro socio (distinto del origen)',
            );
          }
          const beneficiary = await this.accounts.findOne({
            where: { id: beneficiaryId, shopId, active: true },
          });
          if (!beneficiary || beneficiary.type !== LedgerAccountType.PARTNER) {
            throw new BadRequestException('El beneficiario debe ser una cuenta de socio');
          }
          dividendToName = beneficiary.name;
          beneficiaryAccountId = beneficiaryId;
          // Anota el usuario ligado al socio beneficiario; el dinero NO entra a su saldo.
          if (!toUserId) {
            const link = await this.accountLinks.findOne({
              where: { shopId, accountId: beneficiaryId },
            });
            if (link) toUserId = link.userId;
          }
        }
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
        description:
          dto.isDividend && kind === 'transfer'
            ? (
                dto.description?.trim() ||
                (dividendFromName && dividendToName
                  ? `Dividendo · ${dividendFromName} → ${dividendToName}`
                  : dividendFromName
                    ? `Dividendo · ${dividendFromName}`
                    : 'Dividendo')
              )
            : dto.description?.trim() || null,
        amountUyu: money(n(dto.amountUyu)),
        usdRate: dto.usdRate != null ? String(dto.usdRate) : null,
        amountUsd: amountUsd != null ? String(amountUsd) : null,
        conceptId,
        invoiced: dto.invoiced ?? false,
        invoiceNumber: dto.invoiceNumber ?? null,
        employeeId: dto.employeeId ?? null,
        paymentMethod,
        beneficiaryAccountId,
        closingId: opts?.fromPayment ? null : (opts?.closingId ?? null),
        active: true,
      }),
    );
    const created = await this.one(user, shopId, row.id);
    if (dto.notifyAdmins) {
      void this.notifyAdminsMovementCreated(user, shopId, created).catch(() => undefined);
    }
    return created;
  }

  /** Mueve un monto de una cuenta socio a Dividendos del local. */
  async sendToDividends(
    user: AuthUser,
    shopId: string,
    dto: {
      fromAccountId: string;
      amountUyu: number;
      businessDate: string;
      description?: string | null;
      beneficiaryAccountId?: string | null;
    },
  ) {
    return this.create(user, shopId, {
      kind: 'transfer',
      isDividend: true,
      fromAccountId: dto.fromAccountId,
      amountUyu: dto.amountUyu,
      businessDate: dto.businessDate,
      description: dto.description ?? null,
      beneficiaryAccountId: dto.beneficiaryAccountId ?? null,
    });
  }

  private async userOwnsPartnerAccount(
    shopId: string,
    userId: string,
    accountId: string,
  ): Promise<boolean> {
    const account = await this.accounts.findOne({
      where: { id: accountId, shopId, active: true, type: LedgerAccountType.PARTNER },
    });
    if (!account) return false;
    const link = await this.accountLinks.findOne({
      where: { shopId, accountId, userId },
    });
    return !!link;
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
    const dto = this.toDto(row, paymentLinks.get(row.id) ?? null);
    if (dto.isDividend && !dto.beneficiaryAccountId) {
      await this.enrichDividendBeneficiaries(shopId, [dto], [row]);
    }
    return dto;
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

    const kind = dto.isDividend
      ? 'transfer'
      : (dto.kind ??
        this.classifyRow({
          conceptKind: row.concept?.kind,
          fromAccountName: row.fromAccount?.name,
          fromAccountCode: row.fromAccount?.code,
          toAccountName: row.toAccount?.name,
          toAccountCode: row.toAccount?.code,
        }));

    let fromId =
      dto.fromAccountId !== undefined
        ? this.normalizeAccountId(dto.fromAccountId)
        : row.fromAccountId;
    let toId =
      dto.toAccountId !== undefined
        ? this.normalizeAccountId(dto.toAccountId)
        : row.toAccountId;

    let dividendFromName: string | null = null;
    let dividendToName: string | null = null;
    let dividendBeneficiaryId: string | null | undefined = undefined;
    if (kind === 'transfer' && dto.isDividend) {
      const dividends = await this.catalogSeed.ensureDividendsAccount(shopId);
      toId = dividends.id;
      const from = fromId
        ? await this.accounts.findOne({ where: { id: fromId, shopId, active: true } })
        : null;
      if (!from || from.type !== LedgerAccountType.PARTNER) {
        throw new BadRequestException('El dividendo debe salir de una cuenta de socio');
      }
      dividendFromName = from.name;
      if (dto.beneficiaryAccountId !== undefined) {
        const beneficiaryId = this.normalizeAccountId(dto.beneficiaryAccountId);
        dividendBeneficiaryId = beneficiaryId;
        if (beneficiaryId) {
          if (beneficiaryId === fromId) {
            throw new BadRequestException(
              'El beneficiario del dividendo debe ser otro socio (distinto del origen)',
            );
          }
          const beneficiary = await this.accounts.findOne({
            where: { id: beneficiaryId, shopId, active: true },
          });
          if (!beneficiary || beneficiary.type !== LedgerAccountType.PARTNER) {
            throw new BadRequestException('El beneficiario debe ser una cuenta de socio');
          }
          dividendToName = beneficiary.name;
          if (dto.toUserId === undefined) {
            const link = await this.accountLinks.findOne({
              where: { shopId, accountId: beneficiaryId },
            });
            row.toUserId = link?.userId ?? null;
          }
        } else if (dto.toUserId === undefined) {
          row.toUserId = null;
        }
      }
    }

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
    if (dto.fromAccountId !== undefined || dto.isDividend) row.fromAccountId = fromId;
    if (dto.toAccountId !== undefined || dto.isDividend) row.toAccountId = toId;
    if (dto.description !== undefined) {
      row.description = dto.description?.trim() || null;
    } else if (dto.isDividend && kind === 'transfer') {
      row.description =
        dividendFromName && dividendToName
          ? `Dividendo · ${dividendFromName} → ${dividendToName}`
          : dividendFromName
            ? `Dividendo · ${dividendFromName}`
            : 'Dividendo';
    }
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
    if (dividendBeneficiaryId !== undefined) {
      row.beneficiaryAccountId = dividendBeneficiaryId;
    }
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
    const rows = await this.listAnalytics(user, shopId, {
      from: filters.from,
      to: filters.to,
      kind: 'expense',
    });
    const map = new Map<string, { conceptId: string | null; conceptName: string; total: number }>();
    for (const r of rows) {
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

  async balances(
    user: AuthUser,
    shopId: string,
    filters: MovementFilters & { scope?: 'panel' | 'all' } = {},
  ) {
    this.shops.assertShopAccess(user, shopId);
    this.assertAnyPerm(
      user,
      shopId,
      'expenses.read',
      'accountTransfers.read',
      'incomes.read',
      'movements.read',
    );
    const scopeAll = filters.scope === 'all';
    const qb = this.movements
      .createQueryBuilder('m')
      .select(['m.id', 'm.fromAccountId', 'm.toAccountId', 'm.amountUyu'])
      .where('m.shopId = :shopId', { shopId })
      .andWhere('m.active = true');
    if (filters.from) qb.andWhere('m.businessDate >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('m.businessDate <= :to', { to: filters.to });
    const rows = await qb.getMany();
    try {
      await this.catalogSeed.ensureDividendsAccount(shopId);
    } catch {
      // best-effort
    }
    let accounts: LedgerAccount[];
    if (scopeAll) {
      accounts = await this.accounts.find({
        where: { shopId, active: true },
        order: { type: 'ASC', name: 'ASC' },
      });
    } else {
      // Socios + canales (+ Dividendos solo si listInBalances). Sin SYSTEM (INGRESO/EGRESO).
      // Dividendos por defecto no entra: esa plata ya no es del local.
      accounts = (
        await this.accounts.find({
          where: [
            { shopId, active: true, type: LedgerAccountType.PARTNER },
            { shopId, active: true, type: LedgerAccountType.CHANNEL },
            { shopId, active: true, type: LedgerAccountType.DIVIDENDS },
          ],
          order: { type: 'ASC', name: 'ASC' },
        })
      ).filter((a) => Number(a.listInBalances ?? 1) !== 0);
    }
    const bal = new Map<
      string,
      {
        accountId: string;
        name: string;
        type: string;
        income: number;
        expense: number;
        opening: number;
        commissionPercent: number | string;
        listInBalances: boolean;
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
        commissionPercent: a.commissionPercent ?? 0,
        listInBalances: Number(a.listInBalances ?? 1) !== 0,
      });
    }
    for (const r of rows) {
      const amount = n(r.amountUyu);
      if (r.fromAccountId) {
        const from = bal.get(r.fromAccountId);
        if (from) from.expense += amount;
      }
      if (r.toAccountId) {
        const to = bal.get(r.toAccountId);
        if (to) to.income += amount;
      }
    }
    const ordered = [...bal.values()].sort((a, b) => {
      const rank = (t: string) => {
        if (t === LedgerAccountType.CHANNEL) return 0;
        if (t === LedgerAccountType.PARTNER) return 1;
        if (t === LedgerAccountType.DIVIDENDS) return 2;
        if (t === LedgerAccountType.SYSTEM) return 3;
        if (t === LedgerAccountType.SUPPLIER) return 4;
        if (t === LedgerAccountType.SERVICE) return 5;
        return 9;
      };
      const d = rank(a.type) - rank(b.type);
      if (d !== 0) return d;
      return a.name.localeCompare(b.name, 'es');
    });
    return {
      shopId,
      from: filters.from ?? null,
      to: filters.to ?? null,
      scope: scopeAll ? 'all' : 'panel',
      accounts: ordered.map((a) => {
        const gross = Math.round((a.income - a.expense + a.opening) * 100) / 100;
        const comm = accountCommissionOf(gross, a.commissionPercent);
        return {
          accountId: a.accountId,
          name: a.name,
          type: a.type,
          income: a.income,
          expense: a.expense,
          openingBalance: a.opening,
          balance: gross,
          commissionPercent: comm.commissionPercent,
          commissionAmount: comm.commissionAmount,
          netBalance: comm.netBalance,
          listInBalances: a.listInBalances,
        };
      }),
    };
  }

  async exportBalancesXlsx(
    user: AuthUser,
    shopId: string,
    filters: MovementFilters & { scope?: 'panel' | 'all' } = {},
  ) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.getShopEntity(shopId);
    const data = await this.balances(user, shopId, filters);
    const accounts = data.accounts ?? [];
    const hasCommission = accounts.some((a) => Number(a.commissionPercent ?? 0) > 0);
    const colCount = hasCommission ? 4 : 2;
    const lastCol = hasCommission ? 'D' : 'B';
    const shownOf = (a: (typeof accounts)[number]) => Number(a.netBalance ?? a.balance ?? 0);
    const total = accounts.reduce((sum, a) => sum + shownOf(a), 0);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';
    wb.created = new Date();
    const ws = wb.addWorksheet('Saldos');
    ws.getColumn(1).width = 28;
    ws.getColumn(2).width = 18;
    if (hasCommission) {
      ws.getColumn(3).width = 18;
      ws.getColumn(4).width = 18;
    }

    ws.mergeCells(`A1:${lastCol}1`);
    const title = ws.getCell('A1');
    title.value = filters.scope === 'all' ? 'SALDOS · TODAS LAS CUENTAS' : 'SALDOS';
    title.font = { bold: true, size: 14 };
    title.alignment = { horizontal: 'left', vertical: 'middle' };
    title.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    };
    for (let c = 2; c <= colCount; c++) {
      ws.getCell(1, c).border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
    }
    ws.getRow(1).height = 22;

    const header = ws.getRow(2);
    header.values = hasCommission
      ? ['Cuenta', 'Saldo', 'Sin comisión', 'Comisión']
      : ['Cuenta', 'Saldo'];
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
      row.getCell(2).value = formatMoney(shownOf(a));
      row.getCell(1).alignment = { horizontal: 'left' };
      row.getCell(2).alignment = { horizontal: 'right' };
      row.getCell(1).border = thin;
      row.getCell(2).border = thin;
      if (hasCommission) {
        const percent = Number(a.commissionPercent ?? 0);
        row.getCell(3).value = percent > 0 ? formatMoney(a.balance) : '';
        row.getCell(4).value =
          percent > 0 ? `${percent} %  ${formatMoney(a.commissionAmount)}` : '';
        row.getCell(3).alignment = { horizontal: 'right' };
        row.getCell(4).alignment = { horizontal: 'right' };
        row.getCell(3).border = thin;
        row.getCell(4).border = thin;
      }
      rowIdx += 1;
    }

    const totalRow = ws.getRow(rowIdx);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = formatMoney(total);
    totalRow.font = { bold: true };
    totalRow.getCell(1).alignment = { horizontal: 'left' };
    totalRow.getCell(2).alignment = { horizontal: 'right' };
    if (hasCommission) {
      totalRow.getCell(3).border = thin;
      totalRow.getCell(4).border = thin;
    }
    const thickTop = {
      top: { style: 'medium' as const, color: { argb: 'FF000000' } },
      left: { style: 'thin' as const, color: { argb: 'FF000000' } },
      bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
      right: { style: 'thin' as const, color: { argb: 'FF000000' } },
    };
    totalRow.getCell(1).border = thickTop;
    totalRow.getCell(2).border = thickTop;
    if (hasCommission) {
      totalRow.getCell(3).border = thickTop;
      totalRow.getCell(4).border = thickTop;
    }

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
    const amount = formatMoney(Number(movement.amountUyu || 0));
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
    const amount = formatMoney(Number(movement.amountUyu || 0));
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