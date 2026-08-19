import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { AuthUser } from '../../common/decorators';
import { GlobalRole } from '../../common/enums';
import { isSuperAdmin } from '../../common/guards';
import { closingDateKey } from '../../common/soft-delete.util';
import { Shop } from '../../entities/shop.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerAccountUser } from '../../entities/ledger-account-user.entity';
import { Concept } from '../../entities/concept.entity';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingExpense } from '../../entities/closing-expense.entity';
import { ClosingExtraLine } from '../../entities/closing-extra-line.entity';
import { Movement } from '../../entities/movement.entity';
import { Employee } from '../../entities/employee.entity';
import { EmployeeCommissionRule } from '../../entities/employee-commission-rule.entity';
import { AttendanceDay } from '../../entities/attendance-day.entity';
import { PayrollPeriod } from '../../entities/payroll-period.entity';
import { PayrollLine } from '../../entities/payroll-line.entity';
import { PosCategory } from '../../entities/pos-category.entity';
import { PosSubcategory } from '../../entities/pos-subcategory.entity';
import { PosProduct } from '../../entities/pos-product.entity';
import { PosSaleImport } from '../../entities/pos-sale-import.entity';
import { PosSaleTicket } from '../../entities/pos-sale-ticket.entity';
import { PosSaleTicketLine } from '../../entities/pos-sale-ticket-line.entity';
import { PosSaleDaily } from '../../entities/pos-sale-daily.entity';
import { User } from '../../entities/user.entity';

const BACKUP_VERSION = '1';

type Row = Record<string, unknown>;

@Injectable()
export class ShopBackupService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  assertSuperAdmin(user: AuthUser) {
    if (!isSuperAdmin(user.globalRole as GlobalRole)) {
      throw new ForbiddenException('Solo un super admin puede hacer backup/reset de locales');
    }
  }

  async exportBackup(user: AuthUser, shopId: string) {
    this.assertSuperAdmin(user);
    const shop = await this.requireShop(shopId);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';
    wb.created = new Date();

    this.addKvSheet(wb, '_meta', {
      version: BACKUP_VERSION,
      shopId: shop.id,
      slug: shop.slug,
      name: shop.name,
      exportedAt: new Date().toISOString(),
    });

    const accounts = await this.dataSource.getRepository(LedgerAccount).find({
      where: { shopId, deletedAt: IsNull() },
    });
    this.addRowsSheet(
      wb,
      'ledger_accounts',
      accounts.map((a) => ({
        id: a.id,
        name: a.name,
        code: a.code,
        type: a.type,
        linkedPaymentMethod: a.linkedPaymentMethod ?? '',
        active: a.active ? 1 : 0,
      })),
    );

    const accountLinks = await this.dataSource.getRepository(LedgerAccountUser).find({
      where: { shopId },
    });
    this.addRowsSheet(
      wb,
      'ledger_account_users',
      accountLinks.map((l) => ({
        id: l.id,
        accountId: l.accountId,
        userId: l.userId,
      })),
    );

    const concepts = await this.dataSource.getRepository(Concept).find({
      where: { shopId, deletedAt: IsNull() },
    });
    this.addRowsSheet(
      wb,
      'concepts',
      concepts.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description ?? '',
        kind: c.kind,
        validated: c.validated ? 1 : 0,
        active: c.active ? 1 : 0,
      })),
    );

    const categories = await this.dataSource.getRepository(PosCategory).find({
      where: { shopId, deletedAt: IsNull() },
    });
    this.addRowsSheet(
      wb,
      'pos_categories',
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        notes: c.notes ?? '',
        active: c.active ? 1 : 0,
      })),
    );

    const subcategories = await this.dataSource.getRepository(PosSubcategory).find({
      where: { shopId, deletedAt: IsNull() },
    });
    this.addRowsSheet(
      wb,
      'pos_subcategories',
      subcategories.map((s) => ({
        id: s.id,
        categoryId: s.categoryId,
        name: s.name,
        sortOrder: s.sortOrder,
        notes: s.notes ?? '',
        active: s.active ? 1 : 0,
      })),
    );

    const products = await this.dataSource.getRepository(PosProduct).find({
      where: { shopId, deletedAt: IsNull() },
    });
    this.addRowsSheet(
      wb,
      'pos_products',
      products.map((p) => ({
        id: p.id,
        productCode: p.productCode,
        productName: p.productName ?? '',
        category: p.category ?? '',
        subcategory: p.subcategory ?? '',
        categoryId: p.categoryId ?? '',
        subcategoryId: p.subcategoryId ?? '',
        active: p.active ? 1 : 0,
      })),
    );

    const employees = await this.dataSource.getRepository(Employee).find({
      where: { shopId, deletedAt: IsNull() },
    });
    this.addRowsSheet(
      wb,
      'employees',
      employees.map((e) => ({
        id: e.id,
        fullName: e.fullName,
        baseSalary: e.baseSalary,
        userId: e.userId ?? '',
        hireDate: e.hireDate ?? '',
        notes: e.notes ?? '',
        active: e.active ? 1 : 0,
      })),
    );

    const commissionRules = await this.dataSource
      .getRepository(EmployeeCommissionRule)
      .find({ where: { shopId, deletedAt: IsNull() } });
    this.addRowsSheet(
      wb,
      'employee_commission_rules',
      commissionRules.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        category: r.category,
        ratePercent: r.ratePercent,
        notes: r.notes ?? '',
        active: r.active ? 1 : 0,
      })),
    );

    const attendance = await this.dataSource.getRepository(AttendanceDay).find({
      where: { shopId, deletedAt: IsNull() },
    });
    this.addRowsSheet(
      wb,
      'attendance_days',
      attendance.map((a) => ({
        id: a.id,
        employeeId: a.employeeId,
        date: a.date,
        isHoliday: a.isHoliday ? 1 : 0,
        isPresent: a.isPresent ? 1 : 0,
        overtimeHours: a.overtimeHours,
        active: a.active ? 1 : 0,
      })),
    );

    const periods = await this.dataSource.getRepository(PayrollPeriod).find({
      where: { shopId, deletedAt: IsNull() },
    });
    this.addRowsSheet(
      wb,
      'payroll_periods',
      periods.map((p) => ({
        id: p.id,
        year: p.year,
        month: p.month,
        status: p.status,
        active: p.active ? 1 : 0,
      })),
    );

    const periodIds = periods.map((p) => p.id);
    const payrollLinesFixed = periodIds.length
      ? await this.dataSource
          .getRepository(PayrollLine)
          .createQueryBuilder('l')
          .where('l.periodId IN (:...ids)', { ids: periodIds })
          .getMany()
      : [];
    this.addRowsSheet(
      wb,
      'payroll_lines',
      payrollLinesFixed.map((l) => ({
        id: l.id,
        periodId: l.periodId,
        employeeId: l.employeeId,
        daysWorked: l.daysWorked,
        holidayDays: l.holidayDays,
        baseSalarySnapshot: l.baseSalarySnapshot,
        overtimeAmount: l.overtimeAmount,
        attendanceBonus: l.attendanceBonus,
        total: l.total,
        notes: l.notes ?? '',
        active: l.active ? 1 : 0,
      })),
    );

    const closings = await this.dataSource.getRepository(CashClosing).find({
      where: { shopId, deletedAt: IsNull() },
    });
    this.addRowsSheet(
      wb,
      'cash_closings',
      closings.map((c) => this.closingToRow(c)),
    );

    const closingIds = closings.map((c) => c.id);
    const expenses = closingIds.length
      ? await this.dataSource
          .getRepository(ClosingExpense)
          .createQueryBuilder('e')
          .where('e.closingId IN (:...ids)', { ids: closingIds })
          .getMany()
      : [];
    this.addRowsSheet(
      wb,
      'closing_expenses',
      expenses.map((e) => ({
        id: e.id,
        closingId: e.closingId,
        label: e.label,
        amount: e.amount,
        category: e.category,
      })),
    );

    const extras = closingIds.length
      ? await this.dataSource
          .getRepository(ClosingExtraLine)
          .createQueryBuilder('e')
          .where('e.closingId IN (:...ids)', { ids: closingIds })
          .getMany()
      : [];
    this.addRowsSheet(
      wb,
      'closing_extra_lines',
      extras.map((e) => ({
        id: e.id,
        closingId: e.closingId,
        type: e.type,
        label: e.label,
        amount: e.amount,
        meta: e.meta ?? '',
      })),
    );

    const movements = await this.dataSource.getRepository(Movement).find({
      where: { shopId, deletedAt: IsNull() },
    });
    this.addRowsSheet(
      wb,
      'movements',
      movements.map((m) => ({
        id: m.id,
        businessDate: m.businessDate,
        fromAccountId: m.fromAccountId,
        toAccountId: m.toAccountId,
        description: m.description ?? '',
        amountUyu: m.amountUyu,
        usdRate: m.usdRate ?? '',
        amountUsd: m.amountUsd ?? '',
        conceptId: m.conceptId ?? '',
        invoiced: m.invoiced ? 1 : 0,
        invoiceNumber: m.invoiceNumber ?? '',
        closingId: m.closingId ?? '',
        employeeId: m.employeeId ?? '',
        active: m.active ? 1 : 0,
      })),
    );

    const imports = await this.dataSource.getRepository(PosSaleImport).find({
      where: { shopId, deletedAt: IsNull() },
    });
    this.addRowsSheet(
      wb,
      'pos_sale_imports',
      imports.map((i) => ({
        id: i.id,
        salesSystemId: i.salesSystemId,
        fileName: i.fileName ?? '',
        periodFrom: i.periodFrom ?? '',
        periodTo: i.periodTo ?? '',
        ticketCount: i.ticketCount,
        importedByUserId: i.importedByUserId,
        active: i.active ? 1 : 0,
      })),
    );

    const tickets = await this.dataSource.getRepository(PosSaleTicket).find({
      where: { shopId, deletedAt: IsNull() },
    });
    this.addRowsSheet(
      wb,
      'pos_sale_tickets',
      tickets.map((t) => ({
        id: t.id,
        importId: t.importId,
        salesSystemId: t.salesSystemId,
        businessDate: t.businessDate,
        externalId: t.externalId,
        ticketType: t.ticketType ?? '',
        total: t.total,
        subtotal: t.subtotal,
        discount: t.discount,
        paymentCode: t.paymentCode ?? '',
        covers: t.covers,
        externalClosingId: t.externalClosingId ?? '',
        occurredAt: t.occurredAt ?? '',
        active: t.active ? 1 : 0,
      })),
    );

    const ticketIds = tickets.map((t) => t.id);
    const ticketLines = ticketIds.length
      ? await this.dataSource
          .getRepository(PosSaleTicketLine)
          .createQueryBuilder('l')
          .where('l.ticketId IN (:...ids)', { ids: ticketIds })
          .getMany()
      : [];
    this.addRowsSheet(
      wb,
      'pos_sale_ticket_lines',
      ticketLines.map((l) => ({
        id: l.id,
        ticketId: l.ticketId,
        productCode: l.productCode ?? '',
        productName: l.productName ?? '',
        category: l.category ?? '',
        subcategory: l.subcategory ?? '',
        qty: l.qty,
        amount: l.amount,
        active: l.active ? 1 : 0,
      })),
    );

    const dailies = await this.dataSource.getRepository(PosSaleDaily).find({
      where: { shopId, deletedAt: IsNull() },
    });
    this.addRowsSheet(
      wb,
      'pos_sale_dailies',
      dailies.map((d) => ({
        id: d.id,
        businessDate: d.businessDate,
        salesSystemId: d.salesSystemId,
        importId: d.importId,
        totalAmount: d.totalAmount,
        ticketCount: d.ticketCount,
        coversCount: d.coversCount,
        cashAmount: d.cashAmount,
        cardAmount: d.cardAmount,
        mercadoPagoAmount: d.mercadoPagoAmount,
        deliveryAppsAmount: d.deliveryAppsAmount,
        transferAmount: d.transferAmount,
        accountDniAmount: d.accountDniAmount,
        otherAmount: d.otherAmount,
        active: d.active ? 1 : 0,
      })),
    );

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: `backup-${shop.slug || 'local'}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  async resetShop(user: AuthUser, shopId: string, confirm?: string) {
    this.assertSuperAdmin(user);
    if (confirm !== 'RESET') {
      throw new BadRequestException('Confirmá el reset enviando { "confirm": "RESET" }');
    }
    await this.requireShop(shopId);
    await this.purgeShopData(shopId);
    return { ok: true };
  }

  async importBackup(
    user: AuthUser,
    shopId: string,
    file: Express.Multer.File,
    force = false,
  ) {
    this.assertSuperAdmin(user);
    const shop = await this.requireShop(shopId);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Adjuntá un archivo Excel de backup (.xlsx)');
    }

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException('No se pudo leer el Excel de backup');
    }

    const meta = this.readKvSheet(wb, '_meta');
    if (meta.version && String(meta.version) !== BACKUP_VERSION) {
      throw new BadRequestException(`Versión de backup no soportada: ${meta.version}`);
    }
    const metaShopId = String(meta.shopId ?? '');
    if (metaShopId && metaShopId !== shopId) {
      if (!force) {
        throw new BadRequestException(
          `El backup es del local ${meta.slug || metaShopId}, no de este. Usá force=1 para forzar.`,
        );
      }
      if (meta.slug && String(meta.slug) !== shop.slug) {
        throw new BadRequestException(
          `No se puede forzar: el slug del backup (${meta.slug}) no coincide con ${shop.slug}`,
        );
      }
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await this.purgeShopDataWithManager(qr.manager, shopId);
      await this.importFromWorkbook(qr.manager, shopId, user.id, wb);
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    return { ok: true };
  }

  private async purgeShopData(shopId: string) {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await this.purgeShopDataWithManager(qr.manager, shopId);
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  /** Hard-delete all shop-scoped operational + catalog data (incl. soft-deleted). */
  private async purgeShopDataWithManager(manager: any, shopId: string) {
    const run = async (sql: string) => manager.query(sql, [shopId]);

    await run(
      `DELETE FROM pos_sale_ticket_lines WHERE ticketId IN (SELECT id FROM pos_sale_tickets WHERE shopId = ?)`,
    );
    await run(`DELETE FROM pos_sale_tickets WHERE shopId = ?`);
    await run(`DELETE FROM pos_sale_dailies WHERE shopId = ?`);
    await run(`DELETE FROM pos_sale_imports WHERE shopId = ?`);
    await run(
      `DELETE FROM payroll_lines WHERE periodId IN (SELECT id FROM payroll_periods WHERE shopId = ?)`,
    );
    await run(`DELETE FROM payroll_periods WHERE shopId = ?`);
    await run(`DELETE FROM attendance_days WHERE shopId = ?`);
    await run(`DELETE FROM employee_commission_rules WHERE shopId = ?`);
    await run(`DELETE FROM movements WHERE shopId = ?`);
    await run(
      `DELETE FROM closing_expenses WHERE closingId IN (SELECT id FROM cash_closings WHERE shopId = ?)`,
    );
    await run(
      `DELETE FROM closing_extra_lines WHERE closingId IN (SELECT id FROM cash_closings WHERE shopId = ?)`,
    );
    await run(`DELETE FROM cash_closings WHERE shopId = ?`);
    await run(`DELETE FROM ledger_account_users WHERE shopId = ?`);
    await run(`DELETE FROM pos_products WHERE shopId = ?`);
    await run(`DELETE FROM pos_subcategories WHERE shopId = ?`);
    await run(`DELETE FROM pos_categories WHERE shopId = ?`);
    await run(`DELETE FROM concepts WHERE shopId = ?`);
    await run(`DELETE FROM ledger_accounts WHERE shopId = ?`);
    await run(`DELETE FROM employees WHERE shopId = ?`);
  }

  private async importFromWorkbook(
    manager: any,
    shopId: string,
    actorUserId: string,
    wb: ExcelJS.Workbook,
  ) {
    const map = new Map<string, string>();
    const mapId = (oldId: string | null | undefined) => {
      if (!oldId) return null;
      return map.get(oldId) ?? null;
    };
    const newId = (oldId: string) => {
      const id = randomUUID();
      map.set(oldId, id);
      return id;
    };
    const existingUserIds = new Set(
      (await this.users.find({ select: ['id'] })).map((u) => u.id),
    );
    const pickUser = (id: string | null | undefined) =>
      id && existingUserIds.has(id) ? id : actorUserId;

    const accounts = this.readRowsSheet(wb, 'ledger_accounts');
    for (const r of accounts) {
      const id = newId(String(r.id));
      await manager.getRepository(LedgerAccount).save(
        manager.getRepository(LedgerAccount).create({
          id,
          shopId,
          name: String(r.name ?? ''),
          code: String(r.code ?? ''),
          type: r.type as any,
          linkedPaymentMethod: this.emptyToNull(r.linkedPaymentMethod) as any,
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'ledger_account_users')) {
      const accountId = mapId(String(r.accountId));
      const userId = String(r.userId ?? '');
      if (!accountId || !existingUserIds.has(userId)) continue;
      await manager.getRepository(LedgerAccountUser).save(
        manager.getRepository(LedgerAccountUser).create({
          id: randomUUID(),
          shopId,
          accountId,
          userId,
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'concepts')) {
      const id = newId(String(r.id));
      await manager.getRepository(Concept).save(
        manager.getRepository(Concept).create({
          id,
          shopId,
          name: String(r.name ?? ''),
          description: this.emptyToNull(r.description),
          kind: r.kind as any,
          validated: this.toBool(r.validated, true),
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'pos_categories')) {
      const id = newId(String(r.id));
      await manager.getRepository(PosCategory).save(
        manager.getRepository(PosCategory).create({
          id,
          shopId,
          name: String(r.name ?? ''),
          sortOrder: Number(r.sortOrder ?? 0),
          notes: this.emptyToNull(r.notes),
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'pos_subcategories')) {
      const id = newId(String(r.id));
      const categoryId = mapId(String(r.categoryId));
      if (!categoryId) continue;
      await manager.getRepository(PosSubcategory).save(
        manager.getRepository(PosSubcategory).create({
          id,
          shopId,
          categoryId,
          name: String(r.name ?? ''),
          sortOrder: Number(r.sortOrder ?? 0),
          notes: this.emptyToNull(r.notes),
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'pos_products')) {
      const id = newId(String(r.id));
      await manager.getRepository(PosProduct).save(
        manager.getRepository(PosProduct).create({
          id,
          shopId,
          productCode: String(r.productCode ?? ''),
          productName: this.emptyToNull(r.productName),
          category: this.emptyToNull(r.category),
          subcategory: this.emptyToNull(r.subcategory),
          categoryId: mapId(this.emptyToNull(r.categoryId) ?? undefined),
          subcategoryId: mapId(this.emptyToNull(r.subcategoryId) ?? undefined),
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'employees')) {
      const id = newId(String(r.id));
      const userId = this.emptyToNull(r.userId);
      await manager.getRepository(Employee).save(
        manager.getRepository(Employee).create({
          id,
          shopId,
          fullName: String(r.fullName ?? ''),
          baseSalary: String(r.baseSalary ?? '0'),
          userId: userId && existingUserIds.has(userId) ? userId : null,
          hireDate: this.emptyToNull(r.hireDate),
          notes: this.emptyToNull(r.notes),
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'employee_commission_rules')) {
      const employeeId = mapId(String(r.employeeId));
      if (!employeeId) continue;
      await manager.getRepository(EmployeeCommissionRule).save(
        manager.getRepository(EmployeeCommissionRule).create({
          id: newId(String(r.id)),
          shopId,
          employeeId,
          category: String(r.category ?? ''),
          ratePercent: String(r.ratePercent ?? '0'),
          notes: this.emptyToNull(r.notes),
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'attendance_days')) {
      const employeeId = mapId(String(r.employeeId));
      if (!employeeId) continue;
      await manager.getRepository(AttendanceDay).save(
        manager.getRepository(AttendanceDay).create({
          id: newId(String(r.id)),
          shopId,
          employeeId,
          date: String(r.date ?? '').slice(0, 10),
          isHoliday: this.toBool(r.isHoliday, false),
          isPresent: this.toBool(r.isPresent, false),
          overtimeHours: String(r.overtimeHours ?? '0'),
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'payroll_periods')) {
      await manager.getRepository(PayrollPeriod).save(
        manager.getRepository(PayrollPeriod).create({
          id: newId(String(r.id)),
          shopId,
          year: Number(r.year),
          month: Number(r.month),
          status: r.status as any,
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'payroll_lines')) {
      const periodId = mapId(String(r.periodId));
      const employeeId = mapId(String(r.employeeId));
      if (!periodId || !employeeId) continue;
      await manager.getRepository(PayrollLine).save(
        manager.getRepository(PayrollLine).create({
          id: newId(String(r.id)),
          periodId,
          employeeId,
          daysWorked: String(r.daysWorked ?? '0'),
          holidayDays: String(r.holidayDays ?? '0'),
          baseSalarySnapshot: String(r.baseSalarySnapshot ?? '0'),
          overtimeAmount: String(r.overtimeAmount ?? '0'),
          attendanceBonus: String(r.attendanceBonus ?? '0'),
          total: String(r.total ?? '0'),
          notes: this.emptyToNull(r.notes),
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'cash_closings')) {
      const id = newId(String(r.id));
      const businessDate = String(r.businessDate ?? '').slice(0, 10);
      await manager.getRepository(CashClosing).save(
        manager.getRepository(CashClosing).create({
          id,
          shopId,
          businessDate,
          businessDateKey: closingDateKey(businessDate),
          posSystemAmount: String(r.posSystemAmount ?? '0'),
          cardAmount: String(r.cardAmount ?? '0'),
          cashAmount: String(r.cashAmount ?? '0'),
          mercadoPagoAmount: String(r.mercadoPagoAmount ?? '0'),
          deliveryAppsAmount: String(r.deliveryAppsAmount ?? '0'),
          transferAmount: String(r.transferAmount ?? '0'),
          accountDniAmount: String(r.accountDniAmount ?? '0'),
          otherAmount: String(r.otherAmount ?? '0'),
          unitsSold: this.emptyToNull(r.unitsSold) != null ? Number(r.unitsSold) : null,
          coversCount: this.emptyToNull(r.coversCount) != null ? Number(r.coversCount) : null,
          averageTicket: this.emptyToNull(r.averageTicket),
          cashLeftInRegister: String(r.cashLeftInRegister ?? '0'),
          cashPendingPickup: String(r.cashPendingPickup ?? '0'),
          cashWithdrawn: String(r.cashWithdrawn ?? '0'),
          cashWithdrawnByUserId: (() => {
            const u = this.emptyToNull(r.cashWithdrawnByUserId);
            return u && existingUserIds.has(u) ? u : null;
          })(),
          cashWithdrawnByEmployeeId: mapId(this.emptyToNull(r.cashWithdrawnByEmployeeId) ?? undefined),
          cashWithdrawnByName: this.emptyToNull(r.cashWithdrawnByName),
          tipsAmount: String(r.tipsAmount ?? '0'),
          declaredTotal: String(r.declaredTotal ?? '0'),
          calculatedTotal: String(r.calculatedTotal ?? '0'),
          difference: String(r.difference ?? '0'),
          differenceReason: this.emptyToNull(r.differenceReason),
          notes: this.emptyToNull(r.notes),
          evidenceUrl: this.emptyToNull(r.evidenceUrl),
          status: (r.status as any) || 'DRAFT',
          createdByUserId: pickUser(this.emptyToNull(r.createdByUserId)),
          submittedAt: this.emptyToNull(r.submittedAt)
            ? new Date(String(r.submittedAt))
            : null,
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'closing_expenses')) {
      const closingId = mapId(String(r.closingId));
      if (!closingId) continue;
      await manager.getRepository(ClosingExpense).save(
        manager.getRepository(ClosingExpense).create({
          id: randomUUID(),
          closingId,
          label: String(r.label ?? ''),
          amount: String(r.amount ?? '0'),
          category: r.category as any,
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'closing_extra_lines')) {
      const closingId = mapId(String(r.closingId));
      if (!closingId) continue;
      await manager.getRepository(ClosingExtraLine).save(
        manager.getRepository(ClosingExtraLine).create({
          id: randomUUID(),
          closingId,
          type: r.type as any,
          label: String(r.label ?? ''),
          amount: String(r.amount ?? '0'),
          meta: this.emptyToNull(r.meta),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'movements')) {
      const fromAccountId = mapId(String(r.fromAccountId));
      const toAccountId = mapId(String(r.toAccountId));
      if (!fromAccountId || !toAccountId) continue;
      await manager.getRepository(Movement).save(
        manager.getRepository(Movement).create({
          id: newId(String(r.id)),
          shopId,
          businessDate: String(r.businessDate ?? '').slice(0, 10),
          fromAccountId,
          toAccountId,
          description: this.emptyToNull(r.description),
          amountUyu: String(r.amountUyu ?? '0'),
          usdRate: this.emptyToNull(r.usdRate),
          amountUsd: this.emptyToNull(r.amountUsd),
          conceptId: mapId(this.emptyToNull(r.conceptId) ?? undefined),
          invoiced: this.toBool(r.invoiced, false),
          invoiceNumber: this.emptyToNull(r.invoiceNumber),
          closingId: mapId(this.emptyToNull(r.closingId) ?? undefined),
          employeeId: mapId(this.emptyToNull(r.employeeId) ?? undefined),
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'pos_sale_imports')) {
      await manager.getRepository(PosSaleImport).save(
        manager.getRepository(PosSaleImport).create({
          id: newId(String(r.id)),
          shopId,
          salesSystemId: String(r.salesSystemId),
          fileName: this.emptyToNull(r.fileName),
          periodFrom: this.emptyToNull(r.periodFrom),
          periodTo: this.emptyToNull(r.periodTo),
          ticketCount: Number(r.ticketCount ?? 0),
          importedByUserId: pickUser(this.emptyToNull(r.importedByUserId)),
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'pos_sale_tickets')) {
      const importId = mapId(String(r.importId));
      if (!importId) continue;
      await manager.getRepository(PosSaleTicket).save(
        manager.getRepository(PosSaleTicket).create({
          id: newId(String(r.id)),
          shopId,
          importId,
          salesSystemId: String(r.salesSystemId),
          businessDate: String(r.businessDate ?? '').slice(0, 10),
          externalId: String(r.externalId ?? ''),
          ticketType: this.emptyToNull(r.ticketType),
          total: String(r.total ?? '0'),
          subtotal: String(r.subtotal ?? '0'),
          discount: String(r.discount ?? '0'),
          paymentCode: this.emptyToNull(r.paymentCode),
          covers: Number(r.covers ?? 0),
          externalClosingId: this.emptyToNull(r.externalClosingId),
          occurredAt: this.emptyToNull(r.occurredAt),
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'pos_sale_ticket_lines')) {
      const ticketId = mapId(String(r.ticketId));
      if (!ticketId) continue;
      await manager.getRepository(PosSaleTicketLine).save(
        manager.getRepository(PosSaleTicketLine).create({
          id: newId(String(r.id)),
          ticketId,
          productCode: this.emptyToNull(r.productCode),
          productName: this.emptyToNull(r.productName),
          category: this.emptyToNull(r.category),
          subcategory: this.emptyToNull(r.subcategory),
          qty: String(r.qty ?? '0'),
          amount: String(r.amount ?? '0'),
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'pos_sale_dailies')) {
      const importId = mapId(String(r.importId));
      if (!importId) continue;
      await manager.getRepository(PosSaleDaily).save(
        manager.getRepository(PosSaleDaily).create({
          id: newId(String(r.id)),
          shopId,
          businessDate: String(r.businessDate ?? '').slice(0, 10),
          salesSystemId: String(r.salesSystemId),
          importId,
          totalAmount: String(r.totalAmount ?? '0'),
          ticketCount: Number(r.ticketCount ?? 0),
          coversCount: Number(r.coversCount ?? 0),
          cashAmount: String(r.cashAmount ?? '0'),
          cardAmount: String(r.cardAmount ?? '0'),
          mercadoPagoAmount: String(r.mercadoPagoAmount ?? '0'),
          deliveryAppsAmount: String(r.deliveryAppsAmount ?? '0'),
          transferAmount: String(r.transferAmount ?? '0'),
          accountDniAmount: String(r.accountDniAmount ?? '0'),
          otherAmount: String(r.otherAmount ?? '0'),
          active: this.toBool(r.active, true),
        }),
      );
    }
  }

  private closingToRow(c: CashClosing): Row {
    return {
      id: c.id,
      businessDate: c.businessDate,
      businessDateKey: c.businessDateKey ?? '',
      posSystemAmount: c.posSystemAmount,
      cardAmount: c.cardAmount,
      cashAmount: c.cashAmount,
      mercadoPagoAmount: c.mercadoPagoAmount,
      deliveryAppsAmount: c.deliveryAppsAmount,
      transferAmount: c.transferAmount,
      accountDniAmount: c.accountDniAmount,
      otherAmount: c.otherAmount,
      unitsSold: c.unitsSold ?? '',
      coversCount: c.coversCount ?? '',
      averageTicket: c.averageTicket ?? '',
      cashLeftInRegister: c.cashLeftInRegister,
      cashPendingPickup: c.cashPendingPickup,
      cashWithdrawn: c.cashWithdrawn,
      cashWithdrawnByUserId: c.cashWithdrawnByUserId ?? '',
      cashWithdrawnByEmployeeId: c.cashWithdrawnByEmployeeId ?? '',
      cashWithdrawnByName: c.cashWithdrawnByName ?? '',
      tipsAmount: c.tipsAmount,
      declaredTotal: c.declaredTotal,
      calculatedTotal: c.calculatedTotal,
      difference: c.difference,
      differenceReason: c.differenceReason ?? '',
      notes: c.notes ?? '',
      evidenceUrl: c.evidenceUrl ?? '',
      status: c.status,
      createdByUserId: c.createdByUserId,
      submittedAt: c.submittedAt ? new Date(c.submittedAt).toISOString() : '',
      active: c.active ? 1 : 0,
    };
  }

  private async requireShop(shopId: string) {
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    return shop;
  }

  private addKvSheet(wb: ExcelJS.Workbook, name: string, data: Record<string, string>) {
    const ws = wb.addWorksheet(name);
    ws.addRow(['key', 'value']);
    for (const [k, v] of Object.entries(data)) ws.addRow([k, v]);
  }

  private readKvSheet(wb: ExcelJS.Workbook, name: string): Record<string, string> {
    const ws = wb.getWorksheet(name);
    const out: Record<string, string> = {};
    if (!ws) return out;
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const k = String(row.getCell(1).value ?? '').trim();
      const v = String(row.getCell(2).value ?? '').trim();
      if (k) out[k] = v;
    });
    return out;
  }

  private addRowsSheet(wb: ExcelJS.Workbook, name: string, rows: Row[]) {
    const ws = wb.addWorksheet(name);
    if (!rows.length) {
      ws.addRow(['id']);
      return;
    }
    const keys = Object.keys(rows[0]);
    ws.addRow(keys);
    for (const row of rows) {
      ws.addRow(keys.map((k) => row[k] ?? ''));
    }
  }

  private readRowsSheet(wb: ExcelJS.Workbook, name: string): Row[] {
    const ws = wb.getWorksheet(name);
    if (!ws || ws.rowCount < 2) return [];
    const headerRow = ws.getRow(1);
    const keys: Record<number, string> = {};
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      keys[col] = String(cell.value ?? '').trim();
    });
    const fixed: Row[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const obj: Row = {};
      let any = false;
      for (const [colStr, key] of Object.entries(keys)) {
        const col = Number(colStr);
        let val: unknown = row.getCell(col).value;
        if (val && typeof val === 'object' && 'text' in (val as any)) val = (val as any).text;
        if (val && typeof val === 'object' && 'result' in (val as any)) val = (val as any).result;
        if (val instanceof Date) val = val.toISOString().slice(0, 10);
        obj[key] = val ?? '';
        if (val !== null && val !== undefined && String(val) !== '') any = true;
      }
      if (any) fixed.push(obj);
    });
    return fixed;
  }

  private emptyToNull(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s ? s : null;
  }

  private toBool(v: unknown, fallback: boolean): boolean {
    if (v === null || v === undefined || v === '') return fallback;
    if (typeof v === 'boolean') return v;
    const n = Number(v);
    if (!Number.isNaN(n)) return n !== 0;
    const s = String(v).toLowerCase();
    if (s === 'true' || s === 'yes' || s === 'si' || s === 'sí') return true;
    if (s === 'false' || s === 'no') return false;
    return fallback;
  }
}
