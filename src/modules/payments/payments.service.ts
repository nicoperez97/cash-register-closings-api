import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { createReadStream } from 'fs';
import * as ExcelJS from 'exceljs';
import { Payment } from '../../entities/payment.entity';
import { Movement } from '../../entities/movement.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { Supplier } from '../../entities/supplier.entity';
import { Employee } from '../../entities/employee.entity';
import { ShopService } from '../../entities/shop-service.entity';
import { Concept } from '../../entities/concept.entity';
import { AuthUser } from '../../common/decorators';
import { GlobalRole, NotificationType, PaymentMethod, PaymentPriority, PaymentStatus } from '../../common/enums';
import { ShopsService } from '../shops/shops.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MovementsService } from '../movements/movements.service';
import { canEditPayments, resolveUserPermissions } from '../../common/guards';
import { isEntityActive } from '../../common/active.util';
import { resolveShopCalendarDate } from '../../common/business-date';
import { deletePaymentUploads, deleteUploadIfExists, resolveUploadPath, saveUploadFile } from '../../common/uploads';
import { ocrAndParseInvoice, ParsedInvoice } from './invoice-ocr.parser';
import { GeminiDocumentService } from '../ai/gemini-document.service';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

const PAYMENT_METHODS = new Set<string>(Object.values(PaymentMethod));
const PAYMENT_PRIORITIES = new Set<string>(Object.values(PaymentPriority));

export interface UpsertPaymentDto {
  title?: string | null;
  notes?: string | null;
  conceptId?: string | null;
  amount?: number | null;
  dueDate?: string | null;
  priority?: PaymentPriority | string | null;
  status?: PaymentStatus | string | null;
  paidAt?: string | null;
  payerUserId?: string | null;
  validatorUserId?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  paymentMethod?: PaymentMethod | string | null;
  supplierId?: string | null;
  employeeId?: string | null;
  serviceId?: string | null;
  invoiceLegalName?: string | null;
  invoiceTaxId?: string | null;
  invoiceType?: string | null;
  invoiceNumber?: string | null;
  invoiceNetAmount?: number | null;
  invoiceIvaAmount?: number | null;
  invoicePerceptionsAmount?: number | null;
  invoiceOtherTaxesAmount?: number | null;
  notifyAdmins?: boolean;
  notifyUserIds?: string[];
}

@Injectable()
export class PaymentsService implements OnModuleInit {
  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(ShopService) private readonly shopServices: Repository<ShopService>,
    @InjectRepository(Concept) private readonly concepts: Repository<Concept>,
    private readonly shops: ShopsService,
    private readonly notifications: NotificationsService,
    private readonly movements: MovementsService,
    private readonly gemini: GeminiDocumentService,
  ) {}

  async onModuleInit() {
    try {
      await this.payments.query(`
        CREATE TABLE IF NOT EXISTS payments (
          id CHAR(36) NOT NULL PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          title VARCHAR(200) NULL,
          notes VARCHAR(500) NULL,
          amount DECIMAL(14,2) NULL,
          dueDate DATE NULL,
          payerUserId CHAR(36) NULL,
          validatorUserId CHAR(36) NULL,
          accountId CHAR(36) NULL,
          supplierId CHAR(36) NULL,
          employeeId CHAR(36) NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'PENDING_VALIDATION',
          paidAt DATE NULL,
          validatedAt DATETIME(6) NULL,
          validatedByUserId CHAR(36) NULL,
          createdByUserId CHAR(36) NULL,
          movementId CHAR(36) NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX idx_payments_shop (shopId),
          INDEX idx_payments_status (status),
          INDEX idx_payments_payer (payerUserId),
          INDEX idx_payments_validator (validatorUserId)
        )
      `);
    } catch {
      // ya existe
    }
    for (const sql of [
      `ALTER TABLE payments MODIFY COLUMN title VARCHAR(200) NULL`,
      `ALTER TABLE payments MODIFY COLUMN amount DECIMAL(14,2) NULL`,
      `ALTER TABLE payments MODIFY COLUMN dueDate DATE NULL`,
      `ALTER TABLE payments MODIFY COLUMN payerUserId CHAR(36) NULL`,
      `ALTER TABLE payments MODIFY COLUMN validatorUserId CHAR(36) NULL`,
      `ALTER TABLE payments MODIFY COLUMN accountId CHAR(36) NULL`,
      `ALTER TABLE payments ADD COLUMN supplierId CHAR(36) NULL`,
      `ALTER TABLE payments ADD COLUMN employeeId CHAR(36) NULL`,
      `ALTER TABLE payments ADD COLUMN serviceId CHAR(36) NULL`,
      `ALTER TABLE payments ADD COLUMN invoiceLegalName VARCHAR(200) NULL`,
      `ALTER TABLE payments ADD COLUMN invoiceTaxId VARCHAR(20) NULL`,
      `ALTER TABLE payments ADD COLUMN invoiceType VARCHAR(10) NULL`,
      `ALTER TABLE payments ADD COLUMN invoiceNumber VARCHAR(40) NULL`,
      `ALTER TABLE payments ADD COLUMN invoiceNetAmount DECIMAL(14,2) NULL`,
      `ALTER TABLE payments ADD COLUMN invoiceIvaAmount DECIMAL(14,2) NULL`,
      `ALTER TABLE payments ADD COLUMN invoicePerceptionsAmount DECIMAL(14,2) NULL`,
      `ALTER TABLE payments ADD COLUMN invoiceOtherTaxesAmount DECIMAL(14,2) NULL`,
      `ALTER TABLE payments ADD COLUMN invoiceFilePath VARCHAR(500) NULL`,
      `ALTER TABLE payments ADD COLUMN invoiceFileName VARCHAR(255) NULL`,
      `ALTER TABLE payments ADD COLUMN invoiceFileMime VARCHAR(120) NULL`,
      `ALTER TABLE payments ADD COLUMN receiptFilePath VARCHAR(500) NULL`,
      `ALTER TABLE payments ADD COLUMN receiptFileName VARCHAR(255) NULL`,
      `ALTER TABLE payments ADD COLUMN receiptFileMime VARCHAR(120) NULL`,
      `ALTER TABLE payments ADD COLUMN paymentMethod VARCHAR(32) NULL`,
      `ALTER TABLE payments ADD COLUMN priority VARCHAR(16) NULL`,
      `ALTER TABLE payments ADD COLUMN conceptId CHAR(36) NULL`,
      `ALTER TABLE payments ADD COLUMN toAccountId CHAR(36) NULL`,
    ]) {
      try {
        await this.payments.query(sql);
      } catch {
        // ya aplicado
      }
    }
  }

  private canManage(user: AuthUser, shopId: string) {
    return resolveUserPermissions(user, shopId).includes('payments.manage');
  }

  /** Si no hay asignado, solo manage; si hay, el asignado o manage. */
  private assertAssignedOrManage(
    user: AuthUser,
    shopId: string,
    assignedUserId: string | null | undefined,
    roleLabel: string,
  ) {
    if (this.canManage(user, shopId)) return;
    if (assignedUserId && assignedUserId === user.id) return;
    if (!assignedUserId) {
      throw new ForbiddenException(
        `Sin ${roleLabel} asignado: hace falta permiso de gestión de pagos`,
      );
    }
    throw new ForbiddenException(`Solo ${roleLabel} puede hacerlo`);
  }

  private async shopTodayIso(shopId: string): Promise<string> {
    const shop = await this.shops.getShopEntity(shopId);
    return resolveShopCalendarDate(new Date(), { timezone: shop?.timezone });
  }

  private async load(shopId: string, id: string) {
    const row = await this.payments.findOne({
      where: { id, shopId, active: true },
      relations: [
        'payer',
        'validator',
        'account',
        'toAccount',
        'supplier',
        'employee',
        'service',
        'createdBy',
        'concept',
      ],
    });
    if (!row) throw new NotFoundException('Pago no encontrado');
    return row;
  }

  private displayTitle(p: Payment) {
    return (p.concept?.name || p.title || '').trim() || 'Sin concepto';
  }

  private toDto(p: Payment) {
    return {
      id: p.id,
      shopId: p.shopId,
      title: (p.concept?.name || p.title || '').trim(),
      notes: (p.notes || p.concept?.description || '').trim() || null,
      conceptId: p.conceptId ?? null,
      conceptName: p.concept?.name ?? null,
      conceptDescription: p.concept?.description ?? null,
      amount: n(p.amount),
      dueDate: p.dueDate ?? null,
      priority: p.priority ?? null,
      payerUserId: p.payerUserId ?? null,
      payerName: p.payer?.fullName ?? null,
      validatorUserId: p.validatorUserId ?? null,
      validatorName: p.validator?.fullName ?? null,
      accountId: p.accountId ?? null,
      accountName: p.account?.name ?? null,
      toAccountId: p.toAccountId ?? null,
      toAccountName: p.toAccount?.name ?? null,
      paymentMethod: p.paymentMethod ?? null,
      supplierId: p.supplierId ?? null,
      supplierName: p.supplier?.name ?? null,
      supplierBankAlias: p.supplier?.bankAlias ?? null,
      supplierLegalName: p.supplier?.legalName ?? null,
      supplierTaxId: p.supplier?.taxId ?? null,
      employeeId: p.employeeId ?? null,
      employeeName: p.employee?.fullName ?? null,
      serviceId: p.serviceId ?? null,
      serviceName: p.service?.name ?? null,
      serviceBankAlias: p.service?.bankAlias ?? null,
      serviceLegalName: p.service?.legalName ?? null,
      serviceTaxId: p.service?.taxId ?? null,
      status: p.status,
      paidAt: p.paidAt ?? null,
      validatedAt: p.validatedAt ?? null,
      validatedByUserId: p.validatedByUserId ?? null,
      createdByUserId: p.createdByUserId ?? null,
      createdByName: p.createdBy?.fullName ?? null,
      movementId: p.movementId ?? null,
      invoiceLegalName: p.invoiceLegalName ?? null,
      invoiceTaxId: p.invoiceTaxId ?? null,
      invoiceType: p.invoiceType ?? null,
      invoiceNumber: p.invoiceNumber ?? null,
      invoiceNetAmount: p.invoiceNetAmount != null ? n(p.invoiceNetAmount) : null,
      invoiceIvaAmount: p.invoiceIvaAmount != null ? n(p.invoiceIvaAmount) : null,
      invoicePerceptionsAmount:
        p.invoicePerceptionsAmount != null ? n(p.invoicePerceptionsAmount) : null,
      invoiceOtherTaxesAmount:
        p.invoiceOtherTaxesAmount != null ? n(p.invoiceOtherTaxesAmount) : null,
      hasInvoiceFile: !!p.invoiceFilePath,
      invoiceFileName: p.invoiceFileName ?? null,
      hasReceiptFile: !!p.receiptFilePath,
      receiptFileName: p.receiptFileName ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt ?? null,
    };
  }

  private moneyOrNull(v: number | null | undefined | ''): string | null | undefined {
    if (v === undefined) return undefined;
    if (v === null || v === ('' as any)) return null;
    if (n(v) < 0) throw new BadRequestException('El monto no puede ser negativo');
    return money(n(v));
  }

  private parsePaymentMethod(
    value: string | null | undefined,
    opts?: { required?: boolean },
  ): PaymentMethod | null {
    if (value === undefined || value === null || value === '') {
      if (opts?.required) throw new BadRequestException('Indicá la forma de pago');
      return null;
    }
    if (!PAYMENT_METHODS.has(value)) {
      throw new BadRequestException('Forma de pago inválida');
    }
    return value as PaymentMethod;
  }

  private parsePaymentPriority(value: string | null | undefined): PaymentPriority | null {
    if (value === undefined || value === null || value === '') return null;
    if (!PAYMENT_PRIORITIES.has(value)) {
      throw new BadRequestException('Prioridad inválida');
    }
    return value as PaymentPriority;
  }

  private parseCreatedStatus(value: string | null | undefined): PaymentStatus {
    if (value === undefined || value === null || value === '') {
      return PaymentStatus.PENDING_VALIDATION;
    }
    const allowed = new Set<string>(Object.values(PaymentStatus));
    if (!allowed.has(value)) {
      throw new BadRequestException('Estado de pago inválido');
    }
    return value as PaymentStatus;
  }

  private async syncSupplierBilling(
    shopId: string,
    supplierId: string | null | undefined,
    legalName?: string | null,
    taxId?: string | null,
  ) {
    if (!supplierId) return;
    const supplier = await this.suppliers.findOne({
      where: { id: supplierId, shopId, active: true },
    });
    if (!supplier) return;
    let changed = false;
    const nextLegal = (legalName ?? '').trim() || null;
    const nextTax = (taxId ?? '').trim() || null;
    if (nextLegal && nextLegal !== (supplier.legalName ?? null)) {
      supplier.legalName = nextLegal;
      changed = true;
    }
    if (nextTax && nextTax !== (supplier.taxId ?? null)) {
      supplier.taxId = nextTax;
      changed = true;
    }
    if (changed) await this.suppliers.save(supplier);
  }

  private async syncServiceBilling(
    shopId: string,
    serviceId: string | null | undefined,
    legalName?: string | null,
    taxId?: string | null,
  ) {
    if (!serviceId) return;
    const service = await this.shopServices.findOne({
      where: { id: serviceId, shopId, active: true },
    });
    if (!service) return;
    let changed = false;
    const nextLegal = (legalName ?? '').trim() || null;
    const nextTax = (taxId ?? '').trim() || null;
    if (nextLegal && nextLegal !== (service.legalName ?? null)) {
      service.legalName = nextLegal;
      changed = true;
    }
    if (nextTax && nextTax !== (service.taxId ?? null)) {
      service.taxId = nextTax;
      changed = true;
    }
    if (changed) await this.shopServices.save(service);
  }

  private async assertShopUser(shopId: string, userId: string, label: string) {
    const link = await this.userShops.findOne({ where: { shopId, userId } });
    if (!link) throw new BadRequestException(`${label} no pertenece al local`);
    const user = await this.users.findOne({ where: { id: userId, active: true } });
    if (!user) throw new BadRequestException(`${label} inválido`);
    return user;
  }

  private async assertAccount(shopId: string, accountId: string) {
    const acc = await this.accounts.findOne({
      where: { id: accountId, shopId },
    });
    if (!acc) throw new BadRequestException('Cuenta inválida');
    if (!isEntityActive(acc.active)) {
      throw new BadRequestException('La cuenta seleccionada está inactiva');
    }
    return acc;
  }

  private async assertSupplier(shopId: string, supplierId: string) {
    const row = await this.suppliers.findOne({
      where: { id: supplierId, shopId, active: true },
    });
    if (!row) throw new BadRequestException('Proveedor inválido');
    return row;
  }

  private async assertEmployee(shopId: string, employeeId: string) {
    const row = await this.employees.findOne({
      where: { id: employeeId, shopId, active: true },
    });
    if (!row) throw new BadRequestException('Empleado inválido');
    return row;
  }

  private async assertService(shopId: string, serviceId: string) {
    const row = await this.shopServices.findOne({
      where: { id: serviceId, shopId, active: true },
    });
    if (!row) throw new BadRequestException('Servicio inválido');
    return row;
  }

  private assertExclusiveParties(
    supplierId: string | null,
    employeeId: string | null,
    serviceId: string | null,
    toAccountId?: string | null,
  ) {
    const n = [supplierId, employeeId, serviceId].filter(Boolean).length;
    if (n > 1) {
      throw new BadRequestException(
        'Un pago no puede tener proveedor, empleado y servicio a la vez',
      );
    }
    if (toAccountId && n > 0) {
      throw new BadRequestException('Un pago a socio no puede tener proveedor, empleado o servicio');
    }
  }

  private emptyToNull(v?: string | null) {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    return v;
  }

  private async resolveConcept(shopId: string, conceptId?: string | null) {
    const id = this.emptyToNull(conceptId) ?? null;
    if (!id) return null;
    const row = await this.concepts.findOne({ where: { id, shopId } });
    if (!row) throw new BadRequestException('Concepto no encontrado');
    return row;
  }

  private toDateOnly(value: string | Date | null | undefined): string | null {
    if (value == null || value === '') return null;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
    return m?.[1] ?? null;
  }

  private paymentMovementDescription(p: Payment) {
    return [
      `Pago: ${this.displayTitle(p)}`,
      p.supplier?.name ? `Proveedor: ${p.supplier.name}` : null,
      p.service?.name ? `Servicio: ${p.service.name}` : null,
      p.employee?.fullName ? `Empleado: ${p.employee.fullName}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /**
   * Recrea el egreso si un pago Pagado quedó sin movimiento (p. ej. gasto borrado a mano).
   */
  private async ensurePaidMovement(user: AuthUser, shopId: string, payment: Payment) {
    if (payment.status !== PaymentStatus.PAID) return payment;
    if (payment.movementId) {
      const live = await this.movements.isLive(shopId, payment.movementId);
      if (live) return payment;
      payment.movementId = null;
      await this.payments
        .createQueryBuilder()
        .update(Payment)
        .set({ movementId: null })
        .where('id = :id AND shopId = :shopId', { id: payment.id, shopId })
        .execute();
    }
    try {
      await this.syncPaidMovement(user, shopId, payment);
    } catch {
      // No bloquear listados si falta cuenta EGRESO / datos incompletos.
    }
    return this.load(shopId, payment.id);
  }

  private async repairOrphanPaidMovements(user: AuthUser, shopId: string) {
    const orphans = await this.payments
      .createQueryBuilder('p')
      .leftJoin(Movement, 'm', 'm.id = p.movementId AND m.deletedAt IS NULL')
      .where('p.shopId = :shopId', { shopId })
      .andWhere('p.active = true')
      .andWhere('p.status = :st', { st: PaymentStatus.PAID })
      .andWhere('(p.movementId IS NULL OR m.id IS NULL)')
      .take(40)
      .getMany();
    for (const orphan of orphans) {
      try {
        const full = await this.load(shopId, orphan.id);
        await this.ensurePaidMovement(user, shopId, full);
      } catch {
        // seguir con el resto
      }
    }
  }

  /** Actualiza o recrea el movimiento del pago abonado. */
  private async syncPaidMovement(user: AuthUser, shopId: string, payment: Payment) {
    if (!payment.accountId) {
      throw new BadRequestException('Indicá la cuenta con la que se paga');
    }
    if (!(n(payment.amount) > 0)) {
      throw new BadRequestException('Un pago abonado necesita monto mayor a 0');
    }
    // Validar cuenta origen con el mismo criterio que el pago (mensaje claro).
    await this.assertAccount(shopId, payment.accountId);

    const egreso = await this.accounts.findOne({
      where: { shopId, code: 'EGRESO' },
    });
    if (!egreso || !isEntityActive(egreso.active)) {
      throw new BadRequestException('No hay cuenta EGRESO activa en el local');
    }
    const paidAt =
      this.toDateOnly(payment.paidAt) || (await this.shopTodayIso(shopId));
    const invoiced = !!(payment.invoiceNumber || payment.invoiceFilePath);
    const basePayload: {
      businessDate: string;
      fromAccountId: string;
      toAccountId: string;
      employeeId: string | null;
      amountUyu: number;
      description: string;
      conceptId?: string;
      invoiced: boolean;
      invoiceNumber: string | null;
      paymentMethod?: string | null;
    } = {
      businessDate: paidAt,
      fromAccountId: payment.accountId,
      toAccountId: egreso.id,
      employeeId: payment.employeeId ?? null,
      amountUyu: n(payment.amount),
      description: this.paymentMovementDescription(payment),
      invoiced,
      invoiceNumber: payment.invoiceNumber ?? null,
      paymentMethod: payment.paymentMethod ?? null,
    };
    if (payment.conceptId) {
      basePayload.conceptId = payment.conceptId;
    }

    const tryWrite = async (fromUserId: string | null) => {
      const payload = { ...basePayload, fromUserId };
      if (payment.movementId) {
        try {
          await this.movements.update(user, shopId, payment.movementId, payload, {
            fromPayment: true,
          });
          return true;
        } catch (err) {
          if (!(err instanceof NotFoundException)) throw err;
          // movimiento borrado → recrear
        }
      }
      const movement = await this.movements.create(user, shopId, payload, { fromPayment: true });
      // Solo tocar movementId/paidAt por SQL: un save() de la entidad cargada
      // puede pisar accountId con la relación vieja.
      await this.payments
        .createQueryBuilder()
        .update(Payment)
        .set({ movementId: movement.id, paidAt })
        .where('id = :id AND shopId = :shopId', { id: payment.id, shopId })
        .execute();
      payment.movementId = movement.id;
      payment.paidAt = paidAt;
      return true;
    };

    try {
      await tryWrite(payment.payerUserId ?? null);
    } catch (err) {
      // Si el pagador ya no pertenece al local, igual guardamos el movimiento.
      const msg = String((err as Error)?.message ?? err);
      if (payment.payerUserId && /no pertenece al local/i.test(msg)) {
        await tryWrite(null);
        return;
      }
      throw err;
    }
  }

  private parseCsv(raw?: string): string[] {
    if (!raw) return [];
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private parseStatuses(status?: string): string[] {
    return this.parseCsv(status);
  }

  async list(
    user: AuthUser,
    shopId: string,
    opts?: {
      status?: string;
      payerUserId?: string;
      validatorUserId?: string;
      mineUserId?: string;
      dueFrom?: string;
      dueTo?: string;
      paidFrom?: string;
      paidTo?: string;
      supplierId?: string;
      employeeId?: string;
      serviceId?: string;
      amountMin?: string | number;
      amountMax?: string | number;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    await this.repairOrphanPaidMovements(user, shopId);
    const qb = this.payments
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.payer', 'payer')
      .leftJoinAndSelect('p.validator', 'validator')
      .leftJoinAndSelect('p.account', 'account')
      .leftJoinAndSelect('p.toAccount', 'toAccount')
      .leftJoinAndSelect('p.supplier', 'supplier')
      .leftJoinAndSelect('p.employee', 'employee')
      .leftJoinAndSelect('p.service', 'service')
      .leftJoinAndSelect('p.createdBy', 'createdBy')
      .where('p.shopId = :shopId', { shopId })
      .andWhere('p.active = true');
    const statuses = this.parseStatuses(opts?.status);
    if (statuses.length === 1) {
      qb.andWhere('p.status = :status', { status: statuses[0] });
    } else if (statuses.length > 1) {
      qb.andWhere('p.status IN (:...statuses)', { statuses });
    }
    const payerIds = this.parseCsv(opts?.payerUserId);
    if (payerIds.length === 1) {
      qb.andWhere('p.payerUserId = :payerUserId', { payerUserId: payerIds[0] });
    } else if (payerIds.length > 1) {
      qb.andWhere('p.payerUserId IN (:...payerIds)', { payerIds });
    }
    const validatorIds = this.parseCsv(opts?.validatorUserId);
    if (validatorIds.length === 1) {
      qb.andWhere('p.validatorUserId = :validatorUserId', {
        validatorUserId: validatorIds[0],
      });
    } else if (validatorIds.length > 1) {
      qb.andWhere('p.validatorUserId IN (:...validatorIds)', { validatorIds });
    }
    const mineUserId = (opts?.mineUserId ?? '').trim();
    if (mineUserId) {
      qb.andWhere(
        '(p.payerUserId = :mineUserId OR p.validatorUserId = :mineUserId)',
        { mineUserId },
      );
    }
    const dueFrom = this.toDateOnly(opts?.dueFrom);
    const dueTo = this.toDateOnly(opts?.dueTo);
    if (dueFrom) {
      qb.andWhere('p.dueDate IS NOT NULL AND p.dueDate >= :dueFrom', { dueFrom });
    }
    if (dueTo) {
      qb.andWhere('p.dueDate IS NOT NULL AND p.dueDate <= :dueTo', { dueTo });
    }
    const paidFrom = this.toDateOnly(opts?.paidFrom);
    const paidTo = this.toDateOnly(opts?.paidTo);
    if (paidFrom) {
      qb.andWhere('p.paidAt IS NOT NULL AND p.paidAt >= :paidFrom', { paidFrom });
    }
    if (paidTo) {
      qb.andWhere('p.paidAt IS NOT NULL AND p.paidAt <= :paidTo', { paidTo });
    }
    const supplierIds = this.parseCsv(opts?.supplierId);
    if (supplierIds.length === 1) {
      qb.andWhere('p.supplierId = :supplierId', { supplierId: supplierIds[0] });
    } else if (supplierIds.length > 1) {
      qb.andWhere('p.supplierId IN (:...supplierIds)', { supplierIds });
    }
    const employeeIds = this.parseCsv(opts?.employeeId);
    if (employeeIds.length === 1) {
      qb.andWhere('p.employeeId = :employeeId', { employeeId: employeeIds[0] });
    } else if (employeeIds.length > 1) {
      qb.andWhere('p.employeeId IN (:...employeeIds)', { employeeIds });
    }
    const serviceIds = this.parseCsv(opts?.serviceId);
    if (serviceIds.length === 1) {
      qb.andWhere('p.serviceId = :serviceId', { serviceId: serviceIds[0] });
    } else if (serviceIds.length > 1) {
      qb.andWhere('p.serviceId IN (:...serviceIds)', { serviceIds });
    }
    const amountMin =
      opts?.amountMin !== undefined && opts?.amountMin !== null && opts?.amountMin !== ''
        ? Number(opts.amountMin)
        : null;
    const amountMax =
      opts?.amountMax !== undefined && opts?.amountMax !== null && opts?.amountMax !== ''
        ? Number(opts.amountMax)
        : null;
    if (amountMin != null && Number.isFinite(amountMin)) {
      qb.andWhere('p.amount IS NOT NULL AND p.amount >= :amountMin', { amountMin });
    }
    if (amountMax != null && Number.isFinite(amountMax)) {
      qb.andWhere('p.amount IS NOT NULL AND p.amount <= :amountMax', { amountMax });
    }
    qb.orderBy(
      `CASE p.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`,
      'ASC',
    )
      .addOrderBy('p.dueDate', 'ASC')
      .addOrderBy('p.createdAt', 'DESC');
    const rows = await qb.getMany();
    return rows.map((r) => this.toDto(r));
  }

  async exportExcel(
    user: AuthUser,
    shopId: string,
    opts?: {
      status?: string;
      kind?: string;
      payerUserId?: string;
      validatorUserId?: string;
      mineUserId?: string;
      dueFrom?: string;
      dueTo?: string;
      paidFrom?: string;
      paidTo?: string;
      supplierId?: string;
      employeeId?: string;
      serviceId?: string;
      amountMin?: string | number;
      amountMax?: string | number;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne(user, shopId);
    const status = opts?.status;
    let rows = await this.list(user, shopId, {
      status: status || undefined,
      payerUserId: opts?.payerUserId,
      validatorUserId: opts?.validatorUserId,
      mineUserId: opts?.mineUserId,
      dueFrom: opts?.dueFrom,
      dueTo: opts?.dueTo,
      paidFrom: opts?.paidFrom,
      paidTo: opts?.paidTo,
      supplierId: opts?.supplierId,
      employeeId: opts?.employeeId,
      serviceId: opts?.serviceId,
      amountMin: opts?.amountMin,
      amountMax: opts?.amountMax,
    });
    const kindNorm =
      opts?.kind === 'employee' ||
      opts?.kind === 'supplier' ||
      opts?.kind === 'service' ||
      opts?.kind === 'partner'
        ? opts.kind
        : undefined;
    if (kindNorm === 'supplier') rows = rows.filter((r) => !!r.supplierId);
    if (kindNorm === 'service') rows = rows.filter((r) => !!r.serviceId);
    if (kindNorm === 'partner') rows = rows.filter((r) => !!r.toAccountId);
    if (kindNorm === 'employee') {
      rows = rows.filter((r) => !r.supplierId && !r.serviceId && !r.toAccountId);
    }

    const statusLabel = (s: string) =>
      (
        {
          PENDING_VALIDATION: 'Pendiente de validar',
          VALIDATED: 'Validado · por pagar',
          REJECTED: 'Rechazado',
          PAID: 'Pagado',
          CANCELLED: 'Cancelado',
        } as Record<string, string>
      )[s] ?? s;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';
    wb.created = new Date();

    const kindLabel =
      kindNorm === 'supplier'
        ? 'Proveedores'
        : kindNorm === 'service'
          ? 'Servicios'
          : kindNorm === 'employee'
            ? 'Empleados'
            : kindNorm === 'partner'
              ? 'Socios'
              : 'Todos';

    const info = wb.addWorksheet('Resumen');
    info.getColumn(1).width = 48;
    info.addRow(['Exportación de pagos']);
    info.getRow(1).font = { bold: true, size: 13 };
    info.addRow([`Local: ${shop.name}`]);
    info.addRow([`Sección: ${kindLabel}`]);
    info.addRow([`Generado: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`]);
    const statusFilterLabel = (() => {
      const statuses = this.parseStatuses(status);
      if (!statuses.length) return 'Filtro estado: Todos';
      return `Filtro estado: ${statuses.map(statusLabel).join(', ')}`;
    })();
    info.addRow([statusFilterLabel]);
    if (opts?.validatorUserId) {
      info.addRow([`Filtro valida: ${opts.validatorUserId}`]);
    }
    if (opts?.payerUserId) {
      info.addRow([`Filtro paga: ${opts.payerUserId}`]);
    }
    if (opts?.mineUserId) {
      info.addRow(['Filtro: solo asignados a mí (valida o paga)']);
    }
    if (opts?.dueFrom || opts?.dueTo) {
      info.addRow([
        `Filtro vencimiento: ${opts.dueFrom || '…'} → ${opts.dueTo || '…'}`,
      ]);
    }
    if (opts?.paidFrom || opts?.paidTo) {
      info.addRow([
        `Filtro realizado: ${opts.paidFrom || '…'} → ${opts.paidTo || '…'}`,
      ]);
    }
    if (opts?.supplierId) info.addRow([`Filtro proveedor: ${opts.supplierId}`]);
    if (opts?.serviceId) info.addRow([`Filtro servicio: ${opts.serviceId}`]);
    if (opts?.employeeId) info.addRow([`Filtro empleado: ${opts.employeeId}`]);
    if (opts?.amountMin != null && opts?.amountMin !== '') {
      info.addRow([`Monto desde: ${opts.amountMin}`]);
    }
    if (opts?.amountMax != null && opts?.amountMax !== '') {
      info.addRow([`Monto hasta: ${opts.amountMax}`]);
    }
    info.addRow([`Total pagos: ${rows.length}`]);

    const columns = [
      { header: 'Concepto', key: 'title', width: 28 },
      { header: 'Monto', key: 'amount', width: 14 },
      { header: 'Estado', key: 'status', width: 22 },
      { header: 'Prioridad', key: 'priority', width: 12 },
      { header: 'Vence', key: 'dueDate', width: 12 },
      { header: 'Pagado', key: 'paidAt', width: 12 },
      { header: 'Proveedor', key: 'supplier', width: 22 },
      { header: 'Servicio', key: 'service', width: 22 },
      { header: 'Empleado', key: 'employee', width: 22 },
      { header: 'Quién paga', key: 'payer', width: 20 },
      { header: 'Quién valida', key: 'validator', width: 20 },
      { header: 'Cuenta', key: 'account', width: 18 },
      { header: 'Forma de pago', key: 'paymentMethod', width: 16 },
      { header: 'Notas', key: 'notes', width: 32 },
      { header: 'Creado', key: 'createdAt', width: 12 },
    ];

    const methodLabel = (m?: string | null) =>
      m === PaymentMethod.CASH
        ? 'Efectivo'
        : m === PaymentMethod.TRANSFER
          ? 'Transferencia'
          : m === PaymentMethod.CARD
            ? 'Tarjeta'
            : m === PaymentMethod.OTHER
              ? 'Otra'
              : '';

    const priorityLabel = (p?: string | null) =>
      p === PaymentPriority.HIGH
        ? 'Alta'
        : p === PaymentPriority.MEDIUM
          ? 'Media'
          : p === PaymentPriority.LOW
            ? 'Baja'
            : '';

    const ws = wb.addWorksheet(kindLabel);
    ws.columns = columns;
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      ws.addRow({
        title: r.title || 'Sin concepto',
        amount: n(r.amount),
        status: statusLabel(r.status),
        priority: priorityLabel(r.priority),
        dueDate: r.dueDate || '',
        paidAt: r.paidAt || '',
        supplier: r.supplierName || '',
        service: r.serviceName || '',
        employee: r.employeeName || '',
        payer: r.payerName || '',
        validator: r.validatorName || '',
        account: r.accountName || '',
        paymentMethod: methodLabel(r.paymentMethod),
        notes: r.notes || '',
        createdAt: r.createdAt
          ? new Date(r.createdAt).toISOString().slice(0, 10)
          : '',
      });
    }
    ws.getColumn('amount').numFmt = '#,##0.00';

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const slug = this.fileSlug(shop.name || shop.slug || 'local');
    const stamp = new Date().toISOString().slice(0, 10);
    const kindSlug =
      kindNorm === 'supplier'
        ? 'proveedores'
        : kindNorm === 'service'
          ? 'servicios'
          : kindNorm === 'employee'
            ? 'empleados'
            : kindNorm === 'partner'
              ? 'socios'
              : 'todos';
    return {
      buffer,
      filename: `pagos-${kindSlug}-${slug}-${stamp}.xlsx`,
    };
  }

  private fileSlug(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'local';
  }

  async one(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    let row = await this.load(shopId, id);
    if (row.status === PaymentStatus.PAID) {
      row = await this.ensurePaidMovement(user, shopId, row);
    }
    return this.toDto(row);
  }

  async create(user: AuthUser, shopId: string, dto: UpsertPaymentDto) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canManage(user, shopId)) {
      throw new ForbiddenException('Sin permiso para crear pagos');
    }

    const payerUserId = this.emptyToNull(dto.payerUserId) ?? null;
    const validatorUserId = this.emptyToNull(dto.validatorUserId) ?? null;
    const accountId = this.emptyToNull(dto.accountId) ?? null;
    const toAccountId = this.emptyToNull(dto.toAccountId) ?? null;
    const paymentMethod =
      dto.paymentMethod === undefined
        ? null
        : this.parsePaymentMethod(dto.paymentMethod as string | null);
    let supplierId = this.emptyToNull(dto.supplierId) ?? null;
    let employeeId = this.emptyToNull(dto.employeeId) ?? null;
    let serviceId = this.emptyToNull(dto.serviceId) ?? null;
    const dueDate = this.emptyToNull(dto.dueDate) ?? null;
    const amount =
      dto.amount === undefined || dto.amount === null || dto.amount === ('' as any)
        ? null
        : n(dto.amount);

    if (amount !== null && amount < 0) {
      throw new BadRequestException('El monto no puede ser negativo');
    }
    this.assertExclusiveParties(supplierId, employeeId, serviceId, toAccountId);
    if (payerUserId) await this.assertShopUser(shopId, payerUserId, 'Quién paga');
    if (validatorUserId) await this.assertShopUser(shopId, validatorUserId, 'Quién valida');
    if (accountId) await this.assertAccount(shopId, accountId);
    if (toAccountId) await this.assertAccount(shopId, toAccountId);
    if (supplierId) await this.assertSupplier(shopId, supplierId);
    if (employeeId) await this.assertEmployee(shopId, employeeId);
    if (serviceId) await this.assertService(shopId, serviceId);

    const concept = await this.resolveConcept(shopId, dto.conceptId);
    const title = concept?.name?.trim() || dto.title?.trim() || null;
    const notes = dto.notes?.trim() || concept?.description?.trim() || null;

    const requestedStatus = canEditPayments(user, shopId)
      ? this.parseCreatedStatus(dto.status)
      : PaymentStatus.PENDING_VALIDATION;
    if (requestedStatus === PaymentStatus.PAID) {
      if (!(amount != null && amount > 0)) {
        throw new BadRequestException('Un pago abonado necesita un monto mayor a 0');
      }
      if (!accountId) {
        throw new BadRequestException('Indicá la cuenta con la que se paga');
      }
      if (!paymentMethod) {
        throw new BadRequestException('Indicá la forma de pago');
      }
    }

    const row = await this.payments.save(
      this.payments.create({
        shopId,
        title,
        notes,
        conceptId: concept?.id ?? null,
        amount: amount === null ? null : money(amount),
        dueDate,
        priority:
          dto.priority === undefined
            ? null
            : this.parsePaymentPriority(dto.priority as string | null),
        payerUserId,
        validatorUserId,
        accountId,
        toAccountId,
        paymentMethod,
        supplierId,
        employeeId,
        serviceId,
        invoiceLegalName: this.emptyToNull(dto.invoiceLegalName)?.trim() || null,
        invoiceTaxId: this.emptyToNull(dto.invoiceTaxId)?.trim() || null,
        invoiceType: this.emptyToNull(dto.invoiceType)?.trim() || null,
        invoiceNumber: this.emptyToNull(dto.invoiceNumber)?.trim() || null,
        invoiceNetAmount: this.moneyOrNull(dto.invoiceNetAmount) ?? null,
        invoiceIvaAmount: this.moneyOrNull(dto.invoiceIvaAmount) ?? null,
        invoicePerceptionsAmount: this.moneyOrNull(dto.invoicePerceptionsAmount) ?? null,
        invoiceOtherTaxesAmount: this.moneyOrNull(dto.invoiceOtherTaxesAmount) ?? null,
        status: PaymentStatus.PENDING_VALIDATION,
        createdByUserId: user.id,
        active: true,
      }),
    );

    await this.syncSupplierBilling(
      shopId,
      supplierId,
      row.invoiceLegalName,
      row.invoiceTaxId,
    );
    await this.syncServiceBilling(
      shopId,
      serviceId,
      row.invoiceLegalName,
      row.invoiceTaxId,
    );

    if (requestedStatus === PaymentStatus.PENDING_VALIDATION) {
      const loaded = await this.load(shopId, row.id);
      if (validatorUserId) {
        await this.notifications.create({
          userId: validatorUserId,
          shopId,
          type: NotificationType.PAYMENT_VALIDATE,
          title: 'Pago para validar',
          body: `"${this.displayTitle(loaded)}" · $${n(loaded.amount).toLocaleString('es-AR')}${
            loaded.dueDate ? ` · vence ${loaded.dueDate}` : ''
          }`,
          paymentId: loaded.id,
        });
      }
      return this.toDto(loaded);
    }

    if (requestedStatus === PaymentStatus.VALIDATED || requestedStatus === PaymentStatus.PAID) {
      await this.payments.update(
        { id: row.id, shopId },
        {
          status: PaymentStatus.VALIDATED,
          validatedAt: new Date(),
          validatedByUserId: user.id,
        },
      );
      if (requestedStatus === PaymentStatus.PAID) {
        try {
          return await this.pay(user, shopId, row.id, {
            paidAt: this.emptyToNull(dto.paidAt) ?? undefined,
            accountId: accountId ?? undefined,
            paymentMethod: paymentMethod ?? undefined,
          });
        } catch (err) {
          await this.payments.delete({ id: row.id, shopId });
          throw err;
        }
      }
      const loaded = await this.load(shopId, row.id);
      if (loaded.payerUserId) {
        await this.notifications.create({
          userId: loaded.payerUserId,
          shopId,
          type: NotificationType.PAYMENT_PAY,
          title: 'Pago para abonar',
          body: `"${this.displayTitle(loaded)}" · $${n(loaded.amount).toLocaleString('es-AR')}${
            loaded.dueDate ? ` · vence ${loaded.dueDate}` : ''
          }`,
          paymentId: loaded.id,
        });
      }
      return this.toDto(loaded);
    }

    if (requestedStatus === PaymentStatus.REJECTED) {
      await this.payments.update(
        { id: row.id, shopId },
        {
          status: PaymentStatus.REJECTED,
          validatedAt: new Date(),
          validatedByUserId: user.id,
        },
      );
    } else if (requestedStatus === PaymentStatus.CANCELLED) {
      await this.payments.update({ id: row.id, shopId }, { status: PaymentStatus.CANCELLED });
    }

    return this.toDto(await this.load(shopId, row.id));
  }

  async update(user: AuthUser, shopId: string, id: string, dto: Partial<UpsertPaymentDto>) {
    this.shops.assertShopAccess(user, shopId);
    if (!canEditPayments(user, shopId)) {
      throw new ForbiddenException('Sin permiso para editar pagos');
    }
    const row = await this.load(shopId, id);
    if (row.status === PaymentStatus.CANCELLED) {
      throw new BadRequestException('No se puede editar un pago cancelado');
    }

    const patch: Partial<Payment> = {};

    if (dto.title !== undefined) patch.title = dto.title?.trim() || null;
    if (dto.notes !== undefined) patch.notes = dto.notes?.trim() || null;
    if (dto.conceptId !== undefined) {
      const concept = await this.resolveConcept(shopId, dto.conceptId);
      patch.conceptId = concept?.id ?? null;
      if (concept) {
        patch.title = concept.name;
        const nextNotes = (dto.notes !== undefined ? dto.notes : row.notes)?.trim() || null;
        patch.notes = nextNotes || concept.description?.trim() || null;
      }
    }
    if (dto.amount !== undefined) {
      if (dto.amount === null || (dto.amount as any) === '') {
        patch.amount = null;
      } else {
        if (n(dto.amount) < 0) throw new BadRequestException('El monto no puede ser negativo');
        patch.amount = money(n(dto.amount));
      }
    }
    if (dto.dueDate !== undefined) patch.dueDate = this.emptyToNull(dto.dueDate) ?? null;
    if (dto.priority !== undefined) {
      patch.priority = this.parsePaymentPriority(dto.priority as string | null);
    }
    if (dto.paidAt !== undefined) {
      throw new BadRequestException('La fecha de pago solo aplica al abonar el pago');
    }

    let nextPayer = row.payerUserId ?? null;
    if (dto.payerUserId !== undefined) {
      nextPayer = this.emptyToNull(dto.payerUserId) ?? null;
      if (nextPayer) await this.assertShopUser(shopId, nextPayer, 'Quién paga');
      patch.payerUserId = nextPayer;
    }

    let nextValidator = row.validatorUserId ?? null;
    if (dto.validatorUserId !== undefined) {
      nextValidator = this.emptyToNull(dto.validatorUserId) ?? null;
      if (nextValidator) await this.assertShopUser(shopId, nextValidator, 'Quién valida');
      patch.validatorUserId = nextValidator;
    }

    let nextAccountId = row.accountId ?? null;
    if (dto.accountId !== undefined) {
      nextAccountId = this.emptyToNull(dto.accountId) ?? null;
      if (nextAccountId) await this.assertAccount(shopId, nextAccountId);
      patch.accountId = nextAccountId;
    }

    let nextToAccountId = row.toAccountId ?? null;
    if (dto.toAccountId !== undefined) {
      nextToAccountId = this.emptyToNull(dto.toAccountId) ?? null;
      if (nextToAccountId) await this.assertAccount(shopId, nextToAccountId);
      patch.toAccountId = nextToAccountId;
    }

    if (dto.paymentMethod !== undefined) {
      patch.paymentMethod = this.parsePaymentMethod(dto.paymentMethod as string | null);
    }

    let nextSupplierId = row.supplierId ?? null;
    let nextEmployeeId = row.employeeId ?? null;
    let nextServiceId = row.serviceId ?? null;
    if (dto.supplierId !== undefined) {
      nextSupplierId = this.emptyToNull(dto.supplierId) ?? null;
      if (nextSupplierId) await this.assertSupplier(shopId, nextSupplierId);
      patch.supplierId = nextSupplierId;
      if (nextSupplierId) {
        nextEmployeeId = null;
        nextServiceId = null;
        nextToAccountId = null;
        patch.employeeId = null;
        patch.serviceId = null;
        patch.toAccountId = null;
      }
    }
    if (dto.employeeId !== undefined) {
      nextEmployeeId = this.emptyToNull(dto.employeeId) ?? null;
      if (nextEmployeeId) await this.assertEmployee(shopId, nextEmployeeId);
      patch.employeeId = nextEmployeeId;
      if (nextEmployeeId) {
        nextSupplierId = null;
        nextServiceId = null;
        nextToAccountId = null;
        patch.supplierId = null;
        patch.serviceId = null;
        patch.toAccountId = null;
      }
    }
    if (dto.serviceId !== undefined) {
      nextServiceId = this.emptyToNull(dto.serviceId) ?? null;
      if (nextServiceId) await this.assertService(shopId, nextServiceId);
      patch.serviceId = nextServiceId;
      if (nextServiceId) {
        nextSupplierId = null;
        nextEmployeeId = null;
        nextToAccountId = null;
        patch.supplierId = null;
        patch.employeeId = null;
        patch.toAccountId = null;
      }
    }
    if (nextToAccountId) {
      nextSupplierId = null;
      nextEmployeeId = null;
      nextServiceId = null;
      patch.supplierId = null;
      patch.employeeId = null;
      patch.serviceId = null;
    }
    this.assertExclusiveParties(nextSupplierId, nextEmployeeId, nextServiceId, nextToAccountId);

    if (dto.invoiceLegalName !== undefined) {
      patch.invoiceLegalName = this.emptyToNull(dto.invoiceLegalName)?.trim() || null;
    }
    if (dto.invoiceTaxId !== undefined) {
      patch.invoiceTaxId = this.emptyToNull(dto.invoiceTaxId)?.trim() || null;
    }
    if (dto.invoiceType !== undefined) {
      patch.invoiceType = this.emptyToNull(dto.invoiceType)?.trim() || null;
    }
    if (dto.invoiceNumber !== undefined) {
      patch.invoiceNumber = this.emptyToNull(dto.invoiceNumber)?.trim() || null;
    }
    if (dto.invoiceNetAmount !== undefined) {
      patch.invoiceNetAmount = this.moneyOrNull(dto.invoiceNetAmount) ?? null;
    }
    if (dto.invoiceIvaAmount !== undefined) {
      patch.invoiceIvaAmount = this.moneyOrNull(dto.invoiceIvaAmount) ?? null;
    }
    if (dto.invoicePerceptionsAmount !== undefined) {
      patch.invoicePerceptionsAmount = this.moneyOrNull(dto.invoicePerceptionsAmount) ?? null;
    }
    if (dto.invoiceOtherTaxesAmount !== undefined) {
      patch.invoiceOtherTaxesAmount = this.moneyOrNull(dto.invoiceOtherTaxesAmount) ?? null;
    }

    // Editar NUNCA cambia el estado (ni vuelve a validación ni abona).
    if (!Object.keys(patch).length) {
      await this.notifyPaymentChange(
        user,
        shopId,
        row,
        NotificationType.PAYMENT_UPDATED,
        'Pago editado',
        dto,
      );
      return this.toDto(row);
    }

    await this.payments
      .createQueryBuilder()
      .update(Payment)
      .set(patch)
      .where('id = :id AND shopId = :shopId', { id, shopId })
      .execute();

    const billingSupplierId =
      patch.supplierId !== undefined ? nextSupplierId : row.supplierId;
    await this.syncSupplierBilling(
      shopId,
      billingSupplierId,
      patch.invoiceLegalName !== undefined ? patch.invoiceLegalName : row.invoiceLegalName,
      patch.invoiceTaxId !== undefined ? patch.invoiceTaxId : row.invoiceTaxId,
    );
    const billingServiceId =
      patch.serviceId !== undefined ? nextServiceId : row.serviceId;
    await this.syncServiceBilling(
      shopId,
      billingServiceId,
      patch.invoiceLegalName !== undefined ? patch.invoiceLegalName : row.invoiceLegalName,
      patch.invoiceTaxId !== undefined ? patch.invoiceTaxId : row.invoiceTaxId,
    );

    const saved = await this.load(shopId, id);
    if (saved.status === PaymentStatus.PAID) {
      await this.syncPaidMovement(user, shopId, saved);
    }
    await this.notifyPaymentChange(
      user,
      shopId,
      saved,
      NotificationType.PAYMENT_UPDATED,
      'Pago editado',
      dto,
    );
    return this.toDto(await this.load(shopId, id));
  }

  async validate(
    user: AuthUser,
    shopId: string,
    id: string,
    body?: { accountId?: string },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.load(shopId, id);
    if (row.status !== PaymentStatus.PENDING_VALIDATION) {
      throw new BadRequestException('El pago no está pendiente de validación');
    }
    this.assertAssignedOrManage(user, shopId, row.validatorUserId, 'quien valida');

    const accountId = body?.accountId || row.accountId;
    if (!accountId) {
      throw new BadRequestException('Indicá la cuenta con la que se paga');
    }
    await this.assertAccount(shopId, accountId);
    await this.payments
      .createQueryBuilder()
      .update(Payment)
      .set({
        accountId,
        status: PaymentStatus.VALIDATED,
        validatedAt: new Date(),
        validatedByUserId: user.id,
      })
      .where('id = :id AND shopId = :shopId AND status = :st', {
        id,
        shopId,
        st: PaymentStatus.PENDING_VALIDATION,
      })
      .execute();

    if (row.payerUserId) {
      await this.notifications.create({
        userId: row.payerUserId,
        shopId,
        type: NotificationType.PAYMENT_PAY,
        title: 'Pago para abonar',
        body: `"${this.displayTitle(row)}" · $${n(row.amount).toLocaleString('es-AR')}${
          row.dueDate ? ` · vence ${row.dueDate}` : ''
        }`,
        paymentId: row.id,
      });
    }

    return this.toDto(await this.load(shopId, id));
  }

  async reject(user: AuthUser, shopId: string, id: string, reason?: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.load(shopId, id);
    if (row.status !== PaymentStatus.PENDING_VALIDATION) {
      throw new BadRequestException('El pago no está pendiente de validación');
    }
    this.assertAssignedOrManage(user, shopId, row.validatorUserId, 'quien valida');

    row.status = PaymentStatus.REJECTED;
    row.validatedAt = new Date();
    row.validatedByUserId = user.id;
    if (reason?.trim()) {
      row.notes = [row.notes, `Rechazo: ${reason.trim()}`].filter(Boolean).join(' · ');
    }
    await this.payments.save(row);

    const notifyIds = new Set(
      [row.payerUserId, row.createdByUserId].filter(Boolean) as string[],
    );
    notifyIds.delete(user.id);
    for (const uid of notifyIds) {
      await this.notifications.create({
        userId: uid,
        shopId,
        type: NotificationType.PAYMENT_REJECTED,
        title: 'Pago rechazado',
        body: `"${this.displayTitle(row)}" fue rechazado`,
        paymentId: row.id,
      });
    }

    return this.toDto(await this.load(shopId, id));
  }

  async pay(
    user: AuthUser,
    shopId: string,
    id: string,
    body?: { paidAt?: string; accountId?: string; paymentMethod?: string },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.load(shopId, id);
    if (row.status !== PaymentStatus.VALIDATED) {
      throw new BadRequestException('El pago debe estar validado para marcarlo como pagado');
    }
    this.assertAssignedOrManage(user, shopId, row.payerUserId, 'quien paga');

    const accountId = body?.accountId || row.accountId;
    if (!accountId) {
      throw new BadRequestException('Indicá la cuenta con la que se paga');
    }
    if (!(n(row.amount) > 0)) {
      throw new BadRequestException('El pago necesita un monto mayor a 0 para abonarlo');
    }
    await this.assertAccount(shopId, accountId);

    const paymentMethod = this.parsePaymentMethod(
      body?.paymentMethod ?? row.paymentMethod ?? null,
      { required: true },
    );

    const paidAt =
      this.toDateOnly(body?.paidAt) || (await this.shopTodayIso(shopId));
    if (!paidAt) {
      throw new BadRequestException('Fecha de pago inválida');
    }

    let destAccountId = row.toAccountId ?? null;
    if (destAccountId) {
      await this.assertAccount(shopId, destAccountId);
    } else {
      const egreso = await this.accounts.findOne({
        where: { shopId, code: 'EGRESO', active: true },
      });
      if (!egreso) {
        throw new BadRequestException('No hay cuenta EGRESO en el local');
      }
      destAccountId = egreso.id;
    }

    // Claim atómico: evita doble egreso por doble clic / reintento.
    const claim = await this.payments
      .createQueryBuilder()
      .update(Payment)
      .set({
        status: PaymentStatus.PAID,
        paidAt,
        accountId,
        paymentMethod,
      })
      .where('id = :id AND shopId = :shopId AND status = :st AND active = true', {
        id,
        shopId,
        st: PaymentStatus.VALIDATED,
      })
      .execute();
    if (!claim.affected) {
      throw new BadRequestException('El pago ya fue abonado o cambió de estado');
    }

    try {
      const createPayload = {
        businessDate: paidAt,
        fromAccountId: accountId,
        toAccountId: destAccountId,
        fromUserId: row.payerUserId ?? null,
        employeeId: row.employeeId ?? null,
        description: [
          `Pago: ${this.displayTitle(row)}`,
          row.supplier?.name ? `Proveedor: ${row.supplier.name}` : null,
          row.service?.name ? `Servicio: ${row.service.name}` : null,
          row.employee?.fullName ? `Empleado: ${row.employee.fullName}` : null,
          row.toAccount?.name ? `Socio: ${row.toAccount.name}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        amountUyu: n(row.amount),
        conceptId: row.conceptId ?? null,
        invoiced: !!(row.invoiceNumber || row.invoiceFilePath),
        invoiceNumber: row.invoiceNumber ?? null,
        paymentMethod: row.paymentMethod ?? null,
      };
      let movement;
      try {
        movement = await this.movements.create(user, shopId, createPayload, {
          fromPayment: true,
        });
      } catch (err) {
        const msg = String((err as Error)?.message ?? err);
        if (row.payerUserId && /no pertenece al local/i.test(msg)) {
          movement = await this.movements.create(
            user,
            shopId,
            { ...createPayload, fromUserId: null },
            { fromPayment: true },
          );
        } else {
          throw err;
        }
      }

      await this.payments
        .createQueryBuilder()
        .update(Payment)
        .set({ movementId: movement.id })
        .where('id = :id AND shopId = :shopId', { id, shopId })
        .execute();
    } catch (err) {
      await this.payments.update(
        { id, shopId },
        {
          status: PaymentStatus.VALIDATED,
          paidAt: null,
          movementId: null,
          accountId: row.accountId ?? null,
          paymentMethod: row.paymentMethod ?? null,
        },
      );
      throw err;
    }

    void this.notifyAdminsPaymentPaid(user, shopId, row, paidAt).catch(() => undefined);

    return this.toDto(await this.load(shopId, id));
  }

  /** Notifica a admins del local (OWNER/ADMIN) + owners globales cuando un pago queda abonado. */
  private async notifyPaymentChange(
    actor: AuthUser,
    shopId: string,
    payment: Payment,
    type: NotificationType,
    title: string,
    opts?: { notifyAdmins?: boolean; notifyUserIds?: string[] | null },
  ) {
    if (!opts?.notifyAdmins && !opts?.notifyUserIds?.length) return;
    const recipientIds = await this.shops.resolveNotifyUserIds(shopId, actor.id, opts);
    if (!recipientIds.length) return;
    const shop = await this.shops.findOne(actor, shopId);
    const shopName = shop?.name?.trim() || 'Local';
    const body = [
      shopName,
      `"${this.displayTitle(payment)}"`,
      `$${n(payment.amount).toLocaleString('es-AR')}`,
      `por ${actor.fullName || actor.email}`,
    ].join(' · ');
    await this.notifications.createMany(
      recipientIds.map((userId) => ({
        userId,
        shopId,
        type,
        title,
        body,
        paymentId: payment.id,
      })),
    );
  }

  private async notifyAdminsPaymentPaid(
    actor: AuthUser,
    shopId: string,
    payment: Payment,
    paidAt: string,
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

    const title = 'Pago realizado';
    const body = [
      shopName,
      `"${this.displayTitle(payment)}"`,
      `$${n(payment.amount).toLocaleString('es-AR')}`,
      paidAt,
      `por ${actor.fullName || actor.email}`,
    ].join(' · ');

    await this.notifications.createMany(
      [...recipientIds].map((userId) => ({
        userId,
        shopId,
        type: NotificationType.PAYMENT_PAID,
        title,
        body,
        paymentId: payment.id,
      })),
    );
  }

  /**
   * Retrocede un paso del flujo:
   * - VALIDATED → PENDING_VALIDATION (volver a validar)
   * - PAID → VALIDATED (marcar como no pagado; anula el movimiento de egreso)
   */
  async revertStatus(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canManage(user, shopId)) {
      throw new ForbiddenException('Sin permiso para revertir el estado del pago');
    }
    const row = await this.load(shopId, id);

    if (row.status === PaymentStatus.VALIDATED) {
      await this.payments
        .createQueryBuilder()
        .update(Payment)
        .set({
          status: PaymentStatus.PENDING_VALIDATION,
          validatedAt: null,
          validatedByUserId: null,
        })
        .where('id = :id AND shopId = :shopId', { id, shopId })
        .execute();
      return this.toDto(await this.load(shopId, id));
    }

    if (row.status === PaymentStatus.PAID) {
      const movementId = row.movementId;
      if (movementId) {
        try {
          await this.movements.remove(user, shopId, movementId, { fromPayment: true });
        } catch {
          // El movimiento puede haberse borrado antes.
        }
      }
      await this.payments
        .createQueryBuilder()
        .update(Payment)
        .set({
          status: PaymentStatus.VALIDATED,
          paidAt: null,
          movementId: null,
        })
        .where('id = :id AND shopId = :shopId', { id, shopId })
        .execute();
      return this.toDto(await this.load(shopId, id));
    }

    throw new BadRequestException(
      'Solo se puede revertir un pago validado (a pendiente) o pagado (a por pagar)',
    );
  }

  /**
   * Reenvía el aviso de validar (PENDING_VALIDATION → validator)
   * o de abonar (VALIDATED → payer), mismo pipeline que create/validate.
   */
  async resendNotification(
    user: AuthUser,
    shopId: string,
    id: string,
    kind: 'VALIDATE' | 'PAY',
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canManage(user, shopId)) {
      throw new ForbiddenException('Sin permiso para reenviar avisos de pago');
    }
    const row = await this.load(shopId, id);

    if (kind === 'VALIDATE') {
      if (row.status !== PaymentStatus.PENDING_VALIDATION) {
        throw new BadRequestException(
          'Solo se puede reenviar el aviso de validación si el pago está pendiente de validar',
        );
      }
      if (!row.validatorUserId) {
        throw new BadRequestException('El pago no tiene asignado quién valida');
      }
      await this.notifications.create({
        userId: row.validatorUserId,
        shopId,
        type: NotificationType.PAYMENT_VALIDATE,
        title: 'Pago para validar',
        body: `"${this.displayTitle(row)}" · $${n(row.amount).toLocaleString('es-AR')}${
          row.dueDate ? ` · vence ${row.dueDate}` : ''
        }`,
        paymentId: row.id,
      });
      return { ok: true, kind, notifiedUserId: row.validatorUserId };
    }

    if (row.status !== PaymentStatus.VALIDATED) {
      throw new BadRequestException(
        'Solo se puede reenviar el aviso de pago si el pago está validado (pendiente de abonar)',
      );
    }
    if (!row.payerUserId) {
      throw new BadRequestException('El pago no tiene asignado quién paga');
    }
    await this.notifications.create({
      userId: row.payerUserId,
      shopId,
      type: NotificationType.PAYMENT_PAY,
      title: 'Pago para abonar',
      body: `"${this.displayTitle(row)}" · $${n(row.amount).toLocaleString('es-AR')}${
        row.dueDate ? ` · vence ${row.dueDate}` : ''
      }`,
      paymentId: row.id,
    });
    return { ok: true, kind, notifiedUserId: row.payerUserId };
  }

  async cancel(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canManage(user, shopId)) {
      throw new ForbiddenException('Sin permiso para cancelar pagos');
    }
    const row = await this.load(shopId, id);
    if (row.status === PaymentStatus.PAID) {
      throw new BadRequestException('No se puede cancelar un pago ya abonado');
    }
    row.status = PaymentStatus.CANCELLED;
    await this.payments.save(row);
    return this.toDto(await this.load(shopId, id));
  }

  async remove(
    user: AuthUser,
    shopId: string,
    id: string,
    opts?: { notifyAdmins?: boolean; notifyUserIds?: string[] },
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (!canEditPayments(user, shopId)) {
      throw new ForbiddenException('Sin permiso para eliminar pagos');
    }
    const row = await this.load(shopId, id);
    if (row.status === PaymentStatus.PAID) {
      throw new BadRequestException('No se puede eliminar un pago abonado');
    }
    await this.notifyPaymentChange(
      user,
      shopId,
      row,
      NotificationType.PAYMENT_DELETED,
      'Pago eliminado',
      opts,
    );
    // Borra factura/comprobante del disco para no dejar basura
    deleteUploadIfExists(row.invoiceFilePath);
    deleteUploadIfExists(row.receiptFilePath);
    deletePaymentUploads(shopId, id);
    row.invoiceFilePath = null;
    row.invoiceFileName = null;
    row.invoiceFileMime = null;
    row.receiptFilePath = null;
    row.receiptFileName = null;
    row.receiptFileMime = null;
    row.active = false;
    await this.payments.save(row);
    await this.payments.softRemove(row);
    return { ok: true };
  }

  async parseInvoice(
    user: AuthUser,
    shopId: string,
    file: Express.Multer.File,
  ): Promise<ParsedInvoice> {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canManage(user, shopId)) {
      throw new ForbiddenException('Sin permiso para cargar facturas');
    }
    return this.resolveInvoiceParse(file);
  }

  private async resolveInvoiceParse(
    file: Express.Multer.File,
  ): Promise<ParsedInvoice & { engine?: 'classic' | 'gemini'; geminiWarning?: string | null }> {
    if (this.gemini.isEnabled()) {
      const ai = await this.gemini.parseInvoice(file);
      if (ai.ok) {
        return { ...ai.data, engine: 'gemini', geminiWarning: null };
      }
      const classic = await ocrAndParseInvoice(file);
      return { ...classic, engine: 'classic', geminiWarning: ai.message };
    }
    const classic = await ocrAndParseInvoice(file);
    return {
      ...classic,
      engine: 'classic',
      geminiWarning: 'Gemini no está configurado. Se usó el parseo local.',
    };
  }

  async uploadInvoiceFile(
    user: AuthUser,
    shopId: string,
    id: string,
    file: Express.Multer.File,
    applyParsed = true,
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canManage(user, shopId)) {
      throw new ForbiddenException('Sin permiso para cargar facturas');
    }
    const row = await this.load(shopId, id);
    if (!file?.buffer?.length) throw new BadRequestException('Archivo requerido');

    let parsed: ParsedInvoice | null = null;
    if (applyParsed) {
      try {
        parsed = await this.resolveInvoiceParse(file);
      } catch {
        parsed = null;
      }
    }

    deleteUploadIfExists(row.invoiceFilePath);
    const saved = saveUploadFile({
      relativeDir: `payments/${shopId}/${id}`,
      basename: 'invoice',
      buffer: file.buffer,
      originalName: file.originalname,
      mime: file.mimetype,
    });

    const patch: Partial<Payment> = {
      invoiceFilePath: saved.relativePath,
      invoiceFileName: file.originalname || saved.fileName,
      invoiceFileMime: file.mimetype || null,
    };

    if (parsed) {
      if (parsed.legalName) patch.invoiceLegalName = parsed.legalName;
      if (parsed.taxId) patch.invoiceTaxId = parsed.taxId;
      if (parsed.invoiceType) patch.invoiceType = parsed.invoiceType;
      if (parsed.invoiceNumber) patch.invoiceNumber = parsed.invoiceNumber;
      if (parsed.netAmount != null) patch.invoiceNetAmount = money(parsed.netAmount);
      if (parsed.ivaAmount != null) patch.invoiceIvaAmount = money(parsed.ivaAmount);
      if (parsed.perceptionsAmount != null) {
        patch.invoicePerceptionsAmount = money(parsed.perceptionsAmount);
      }
      if (parsed.otherTaxesAmount != null) {
        patch.invoiceOtherTaxesAmount = money(parsed.otherTaxesAmount);
      }
      if (parsed.totalAmount != null && !(n(row.amount) > 0)) {
        patch.amount = money(parsed.totalAmount);
      }
    }

    await this.payments
      .createQueryBuilder()
      .update(Payment)
      .set(patch)
      .where('id = :id AND shopId = :shopId', { id, shopId })
      .execute();

    await this.syncSupplierBilling(
      shopId,
      row.supplierId,
      patch.invoiceLegalName ?? row.invoiceLegalName,
      patch.invoiceTaxId ?? row.invoiceTaxId,
    );
    await this.syncServiceBilling(
      shopId,
      row.serviceId,
      patch.invoiceLegalName ?? row.invoiceLegalName,
      patch.invoiceTaxId ?? row.invoiceTaxId,
    );

    return this.toDto(await this.load(shopId, id));
  }

  async uploadReceiptFile(
    user: AuthUser,
    shopId: string,
    id: string,
    file: Express.Multer.File,
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.load(shopId, id);
    if (row.status !== PaymentStatus.PAID) {
      throw new BadRequestException('Solo se puede adjuntar comprobante a un pago abonado');
    }
    const canUpload =
      this.canManage(user, shopId) ||
      (row.payerUserId && row.payerUserId === user.id);
    if (!canUpload) {
      throw new ForbiddenException('Sin permiso para cargar el comprobante');
    }
    if (!file?.buffer?.length) throw new BadRequestException('Archivo requerido');

    deleteUploadIfExists(row.receiptFilePath);
    const saved = saveUploadFile({
      relativeDir: `payments/${shopId}/${id}`,
      basename: 'receipt',
      buffer: file.buffer,
      originalName: file.originalname,
      mime: file.mimetype,
    });

    await this.payments
      .createQueryBuilder()
      .update(Payment)
      .set({
        receiptFilePath: saved.relativePath,
        receiptFileName: file.originalname || saved.fileName,
        receiptFileMime: file.mimetype || null,
      })
      .where('id = :id AND shopId = :shopId', { id, shopId })
      .execute();

    return this.toDto(await this.load(shopId, id));
  }

  async downloadInvoiceFile(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.load(shopId, id);
    const abs = resolveUploadPath(row.invoiceFilePath);
    if (!abs) throw new NotFoundException('Factura no encontrada');
    return {
      stream: new StreamableFile(createReadStream(abs)),
      fileName: row.invoiceFileName || 'factura.pdf',
      mime: row.invoiceFileMime || 'application/octet-stream',
    };
  }

  async downloadReceiptFile(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.load(shopId, id);
    const abs = resolveUploadPath(row.receiptFilePath);
    if (!abs) throw new NotFoundException('Comprobante no encontrado');
    return {
      stream: new StreamableFile(createReadStream(abs)),
      fileName: row.receiptFileName || 'comprobante.pdf',
      mime: row.receiptFileMime || 'application/octet-stream',
    };
  }
}
