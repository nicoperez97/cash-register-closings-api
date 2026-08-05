import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Payment } from '../../entities/payment.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { Supplier } from '../../entities/supplier.entity';
import { Employee } from '../../entities/employee.entity';
import { AuthUser } from '../../common/decorators';
import { NotificationType, PaymentStatus } from '../../common/enums';
import { ShopsService } from '../shops/shops.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MovementsService } from '../movements/movements.service';
import { resolveUserPermissions } from '../../common/guards';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

export interface UpsertPaymentDto {
  title?: string | null;
  notes?: string | null;
  amount?: number | null;
  dueDate?: string | null;
  paidAt?: string | null;
  payerUserId?: string | null;
  validatorUserId?: string | null;
  accountId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
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
    private readonly shops: ShopsService,
    private readonly notifications: NotificationsService,
    private readonly movements: MovementsService,
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

  private async load(shopId: string, id: string) {
    const row = await this.payments.findOne({
      where: { id, shopId, active: true },
      relations: ['payer', 'validator', 'account', 'supplier', 'employee'],
    });
    if (!row) throw new NotFoundException('Pago no encontrado');
    return row;
  }

  private displayTitle(p: Payment) {
    return (p.title || '').trim() || 'Sin concepto';
  }

  private toDto(p: Payment) {
    return {
      id: p.id,
      shopId: p.shopId,
      title: p.title ?? '',
      notes: p.notes ?? null,
      amount: n(p.amount),
      dueDate: p.dueDate ?? null,
      payerUserId: p.payerUserId ?? null,
      payerName: p.payer?.fullName ?? null,
      validatorUserId: p.validatorUserId ?? null,
      validatorName: p.validator?.fullName ?? null,
      accountId: p.accountId ?? null,
      accountName: p.account?.name ?? null,
      supplierId: p.supplierId ?? null,
      supplierName: p.supplier?.name ?? null,
      employeeId: p.employeeId ?? null,
      employeeName: p.employee?.fullName ?? null,
      status: p.status,
      paidAt: p.paidAt ?? null,
      validatedAt: p.validatedAt ?? null,
      validatedByUserId: p.validatedByUserId ?? null,
      createdByUserId: p.createdByUserId ?? null,
      movementId: p.movementId ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt ?? null,
    };
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
      where: { id: accountId, shopId, active: true },
    });
    if (!acc) throw new BadRequestException('Cuenta inválida');
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

  private emptyToNull(v?: string | null) {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    return v;
  }

  async list(user: AuthUser, shopId: string, status?: string) {
    this.shops.assertShopAccess(user, shopId);
    const qb = this.payments
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.payer', 'payer')
      .leftJoinAndSelect('p.validator', 'validator')
      .leftJoinAndSelect('p.account', 'account')
      .leftJoinAndSelect('p.supplier', 'supplier')
      .leftJoinAndSelect('p.employee', 'employee')
      .where('p.shopId = :shopId', { shopId })
      .andWhere('p.active = true');
    if (status) qb.andWhere('p.status = :status', { status });
    qb.orderBy('p.dueDate', 'ASC').addOrderBy('p.createdAt', 'DESC');
    const rows = await qb.getMany();
    return rows.map((r) => this.toDto(r));
  }

  async exportExcel(
    user: AuthUser,
    shopId: string,
    status?: string,
    kind?: string,
  ) {
    this.shops.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne(user, shopId);
    let rows = await this.list(user, shopId, status || undefined);
    const kindNorm = kind === 'employee' || kind === 'supplier' ? kind : undefined;
    if (kindNorm === 'supplier') rows = rows.filter((r) => !!r.supplierId);
    if (kindNorm === 'employee') rows = rows.filter((r) => !r.supplierId);

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
        : kindNorm === 'employee'
          ? 'Empleados'
          : 'Todos';

    const info = wb.addWorksheet('Resumen');
    info.getColumn(1).width = 48;
    info.addRow(['Exportación de pagos']);
    info.getRow(1).font = { bold: true, size: 13 };
    info.addRow([`Local: ${shop.name}`]);
    info.addRow([`Sección: ${kindLabel}`]);
    info.addRow([`Generado: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`]);
    info.addRow([status ? `Filtro estado: ${statusLabel(status)}` : 'Filtro estado: Todos']);
    info.addRow([`Total pagos: ${rows.length}`]);

    const columns = [
      { header: 'Concepto', key: 'title', width: 28 },
      { header: 'Monto', key: 'amount', width: 14 },
      { header: 'Estado', key: 'status', width: 22 },
      { header: 'Vence', key: 'dueDate', width: 12 },
      { header: 'Pagado', key: 'paidAt', width: 12 },
      { header: 'Proveedor', key: 'supplier', width: 22 },
      { header: 'Empleado', key: 'employee', width: 22 },
      { header: 'Quién paga', key: 'payer', width: 20 },
      { header: 'Quién valida', key: 'validator', width: 20 },
      { header: 'Cuenta', key: 'account', width: 18 },
      { header: 'Notas', key: 'notes', width: 32 },
      { header: 'Creado', key: 'createdAt', width: 12 },
    ];

    const ws = wb.addWorksheet(kindLabel);
    ws.columns = columns;
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      ws.addRow({
        title: r.title || 'Sin concepto',
        amount: n(r.amount),
        status: statusLabel(r.status),
        dueDate: r.dueDate || '',
        paidAt: r.paidAt || '',
        supplier: r.supplierName || '',
        employee: r.employeeName || '',
        payer: r.payerName || '',
        validator: r.validatorName || '',
        account: r.accountName || '',
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
        : kindNorm === 'employee'
          ? 'empleados'
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
    return this.toDto(await this.load(shopId, id));
  }

  async create(user: AuthUser, shopId: string, dto: UpsertPaymentDto) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canManage(user, shopId)) {
      throw new ForbiddenException('Sin permiso para crear pagos');
    }

    const payerUserId = this.emptyToNull(dto.payerUserId) ?? null;
    const validatorUserId = this.emptyToNull(dto.validatorUserId) ?? null;
    const accountId = this.emptyToNull(dto.accountId) ?? null;
    let supplierId = this.emptyToNull(dto.supplierId) ?? null;
    let employeeId = this.emptyToNull(dto.employeeId) ?? null;
    const dueDate = this.emptyToNull(dto.dueDate) ?? null;
    const amount =
      dto.amount === undefined || dto.amount === null || dto.amount === ('' as any)
        ? null
        : n(dto.amount);

    if (amount !== null && amount < 0) {
      throw new BadRequestException('El monto no puede ser negativo');
    }
    if (supplierId && employeeId) {
      throw new BadRequestException('Un pago no puede tener proveedor y empleado a la vez');
    }
    if (payerUserId) await this.assertShopUser(shopId, payerUserId, 'Quién paga');
    if (validatorUserId) await this.assertShopUser(shopId, validatorUserId, 'Quién valida');
    if (accountId) await this.assertAccount(shopId, accountId);
    if (supplierId) await this.assertSupplier(shopId, supplierId);
    if (employeeId) await this.assertEmployee(shopId, employeeId);

    const row = await this.payments.save(
      this.payments.create({
        shopId,
        title: dto.title?.trim() || null,
        notes: dto.notes?.trim() || null,
        amount: amount === null ? null : money(amount),
        dueDate,
        payerUserId,
        validatorUserId,
        accountId,
        supplierId,
        employeeId,
        status: PaymentStatus.PENDING_VALIDATION,
        createdByUserId: user.id,
        active: true,
      }),
    );

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

  async update(user: AuthUser, shopId: string, id: string, dto: Partial<UpsertPaymentDto>) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canManage(user, shopId)) {
      throw new ForbiddenException('Sin permiso para editar pagos');
    }
    const row = await this.load(shopId, id);
    if (row.status === PaymentStatus.CANCELLED) {
      throw new BadRequestException('No se puede editar un pago cancelado');
    }

    const wasPaid = row.status === PaymentStatus.PAID;

    if (dto.title !== undefined) row.title = dto.title?.trim() || null;
    if (dto.notes !== undefined) row.notes = dto.notes?.trim() || null;
    if (dto.amount !== undefined) {
      if (dto.amount === null || (dto.amount as any) === '') {
        if (wasPaid) throw new BadRequestException('Un pago abonado necesita monto');
        row.amount = null;
      } else {
        if (n(dto.amount) < 0) throw new BadRequestException('El monto no puede ser negativo');
        if (wasPaid && !(n(dto.amount) > 0)) {
          throw new BadRequestException('Un pago abonado necesita monto mayor a 0');
        }
        row.amount = money(n(dto.amount));
      }
    }
    if (dto.dueDate !== undefined) row.dueDate = this.emptyToNull(dto.dueDate) ?? null;
    if (dto.paidAt !== undefined) {
      if (!wasPaid) {
        throw new BadRequestException('La fecha de pago solo aplica a pagos abonados');
      }
      const paidAt = this.emptyToNull(dto.paidAt);
      if (!paidAt) throw new BadRequestException('Indicá la fecha de pago');
      row.paidAt = paidAt;
    }
    if (dto.payerUserId !== undefined) {
      const payerUserId = this.emptyToNull(dto.payerUserId) ?? null;
      if (payerUserId) await this.assertShopUser(shopId, payerUserId, 'Quién paga');
      row.payerUserId = payerUserId;
    }
    if (dto.validatorUserId !== undefined) {
      const validatorUserId = this.emptyToNull(dto.validatorUserId) ?? null;
      if (validatorUserId) await this.assertShopUser(shopId, validatorUserId, 'Quién valida');
      row.validatorUserId = validatorUserId;
    }
    if (dto.accountId !== undefined) {
      const accountId = this.emptyToNull(dto.accountId) ?? null;
      if (wasPaid && !accountId) {
        throw new BadRequestException('Un pago abonado necesita la cuenta que paga');
      }
      if (accountId) await this.assertAccount(shopId, accountId);
      row.accountId = accountId;
    }
    if (dto.supplierId !== undefined) {
      const supplierId = this.emptyToNull(dto.supplierId) ?? null;
      if (supplierId) await this.assertSupplier(shopId, supplierId);
      row.supplierId = supplierId;
      if (supplierId) row.employeeId = null;
    }
    if (dto.employeeId !== undefined) {
      const employeeId = this.emptyToNull(dto.employeeId) ?? null;
      if (employeeId) await this.assertEmployee(shopId, employeeId);
      row.employeeId = employeeId;
      if (employeeId) row.supplierId = null;
    }
    if (row.supplierId && row.employeeId) {
      throw new BadRequestException('Un pago no puede tener proveedor y empleado a la vez');
    }

    const wasValidated = !wasPaid && row.status === PaymentStatus.VALIDATED;
    if (wasValidated) {
      row.status = PaymentStatus.PENDING_VALIDATION;
      row.validatedAt = null;
      row.validatedByUserId = null;
    }

    await this.payments.save(row);
    const loaded = await this.load(shopId, id);

    if (wasPaid && loaded.movementId) {
      const egreso = await this.accounts.findOne({
        where: { shopId, code: 'EGRESO', active: true },
      });
      if (!egreso) {
        throw new BadRequestException('No hay cuenta EGRESO en el local');
      }
      if (!loaded.accountId) {
        throw new BadRequestException('Indicá la cuenta con la que se paga');
      }
      await this.movements.update(user, shopId, loaded.movementId, {
        businessDate: loaded.paidAt || undefined,
        fromAccountId: loaded.accountId,
        toAccountId: egreso.id,
        fromUserId: loaded.payerUserId ?? null,
        employeeId: loaded.employeeId ?? null,
        amountUyu: n(loaded.amount),
        description: [
          `Pago: ${this.displayTitle(loaded)}`,
          loaded.supplier?.name ? `Proveedor: ${loaded.supplier.name}` : null,
          loaded.employee?.fullName ? `Empleado: ${loaded.employee.fullName}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }

    if (wasValidated && loaded.validatorUserId) {
      await this.notifications.create({
        userId: loaded.validatorUserId,
        shopId,
        type: NotificationType.PAYMENT_VALIDATE,
        title: 'Pago para revalidar',
        body: `"${this.displayTitle(loaded)}" fue editado y necesita validación otra vez`,
        paymentId: loaded.id,
      });
    }

    return this.toDto(loaded);
  }

  async validate(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.load(shopId, id);
    if (row.status !== PaymentStatus.PENDING_VALIDATION) {
      throw new BadRequestException('El pago no está pendiente de validación');
    }
    if (
      row.validatorUserId &&
      row.validatorUserId !== user.id &&
      !this.canManage(user, shopId)
    ) {
      throw new ForbiddenException('Solo quien valida puede aprobar este pago');
    }

    row.status = PaymentStatus.VALIDATED;
    row.validatedAt = new Date();
    row.validatedByUserId = user.id;
    await this.payments.save(row);

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
    if (
      row.validatorUserId &&
      row.validatorUserId !== user.id &&
      !this.canManage(user, shopId)
    ) {
      throw new ForbiddenException('Solo quien valida puede rechazar este pago');
    }

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
    body?: { paidAt?: string; accountId?: string },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.load(shopId, id);
    if (row.status !== PaymentStatus.VALIDATED) {
      throw new BadRequestException('El pago debe estar validado para marcarlo como pagado');
    }
    if (row.payerUserId && row.payerUserId !== user.id && !this.canManage(user, shopId)) {
      throw new ForbiddenException('Solo quien paga puede marcar este pago como pagado');
    }

    const accountId = body?.accountId || row.accountId;
    if (!accountId) {
      throw new BadRequestException('Indicá la cuenta con la que se paga');
    }
    if (!(n(row.amount) > 0)) {
      throw new BadRequestException('El pago necesita un monto mayor a 0 para abonarlo');
    }
    await this.assertAccount(shopId, accountId);
    row.accountId = accountId;

    const paidAt = body?.paidAt || new Date().toISOString().slice(0, 10);

    const egreso = await this.accounts.findOne({
      where: { shopId, code: 'EGRESO', active: true },
    });
    if (!egreso) {
      throw new BadRequestException('No hay cuenta EGRESO en el local');
    }

    const movement = await this.movements.create(user, shopId, {
      businessDate: paidAt,
      fromAccountId: accountId,
      toAccountId: egreso.id,
      fromUserId: row.payerUserId ?? null,
      employeeId: row.employeeId ?? null,
      description: [
        `Pago: ${this.displayTitle(row)}`,
        row.supplier?.name ? `Proveedor: ${row.supplier.name}` : null,
        row.employee?.fullName ? `Empleado: ${row.employee.fullName}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      amountUyu: n(row.amount),
    });

    row.status = PaymentStatus.PAID;
    row.paidAt = paidAt;
    row.movementId = movement.id;
    await this.payments.save(row);

    const notifyIds = new Set(
      [row.validatorUserId, row.createdByUserId].filter(Boolean) as string[],
    );
    notifyIds.delete(user.id);
    for (const uid of notifyIds) {
      await this.notifications.create({
        userId: uid,
        shopId,
        type: NotificationType.PAYMENT_PAID,
        title: 'Pago realizado',
        body: `"${this.displayTitle(row)}" · $${n(row.amount).toLocaleString('es-AR')} · ${paidAt}`,
        paymentId: row.id,
      });
    }

    return this.toDto(await this.load(shopId, id));
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

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canManage(user, shopId)) {
      throw new ForbiddenException('Sin permiso para eliminar pagos');
    }
    const row = await this.load(shopId, id);
    if (row.status === PaymentStatus.PAID) {
      throw new BadRequestException('No se puede eliminar un pago abonado');
    }
    row.active = false;
    await this.payments.softRemove(row);
    return { ok: true };
  }
}
