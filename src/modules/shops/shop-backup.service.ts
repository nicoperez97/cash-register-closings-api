import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { AuthUser } from '../../common/decorators';
import { GlobalRole } from '../../common/enums';
import { isSuperAdmin } from '../../common/guards';
import { closingDateKey, closingEventDateKey } from '../../common/soft-delete.util';
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
import {
  BackupModuleId,
  BackupPurgeStep,
  BackupSheetName,
  classifyBackupMovement,
  expandBackupModules,
  modulesLabelList,
  movementSlicesForModules,
  parseBackupModulesParam,
  purgeStepsForModules,
  sheetsForModules,
} from './shop-backup-modules';

const BACKUP_VERSION = '2';
/** Versiones de Excel aceptadas al restaurar (v1 sin shopConfig / hojas nuevas). */
const SUPPORTED_BACKUP_VERSIONS = new Set(['1', '2']);

type Row = Record<string, unknown>;

export type BackupFormat = 'xlsx' | 'sql';

export interface ExportBackupOptions {
  modules?: string | string[] | null;
  format?: BackupFormat | string | null;
}

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

  async exportBackup(user: AuthUser, shopId: string, opts: ExportBackupOptions = {}) {
    this.assertSuperAdmin(user);
    const shop = await this.requireShop(shopId);

    let modules: BackupModuleId[] | 'all';
    try {
      modules = parseBackupModulesParam(opts.modules);
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Módulos inválidos');
    }
    const format: BackupFormat = opts.format === 'sql' ? 'sql' : 'xlsx';
    const sheetSet = sheetsForModules(modules);
    const modulesCsv = modulesLabelList(modules);

    const sheets = await this.collectSheetRows(shopId, sheetSet, modules);

    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `backup-${shop.slug || 'local'}-${stamp}`;

    if (format === 'sql') {
      const sql = this.buildSqlDump({
        shopId: shop.id,
        slug: shop.slug,
        name: shop.name,
        modules: modulesCsv,
        sheets,
      });
      return {
        buffer: Buffer.from(sql, 'utf8'),
        filename: `${baseName}.sql`,
        contentType: 'application/sql; charset=utf-8',
      };
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cash Register Closings';
    wb.created = new Date();

    this.addKvSheet(wb, '_meta', {
      version: BACKUP_VERSION,
      shopId: shop.id,
      slug: shop.slug,
      name: shop.name,
      modules: modulesCsv,
      exportedAt: new Date().toISOString(),
    });

    for (const [name, rows] of sheets) {
      this.addRowsSheet(wb, name, rows);
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: `${baseName}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  async resetShop(
    user: AuthUser,
    shopId: string,
    confirm?: string,
    modulesRaw?: string[] | string | null,
  ) {
    this.assertSuperAdmin(user);
    if (confirm !== 'RESET') {
      throw new BadRequestException('Confirmá el reset enviando { "confirm": "RESET" }');
    }
    await this.requireShop(shopId);
    let modules: BackupModuleId[] | 'all';
    try {
      modules =
        modulesRaw == null || (Array.isArray(modulesRaw) && !modulesRaw.length)
          ? 'all'
          : parseBackupModulesParam(
              Array.isArray(modulesRaw) ? modulesRaw.join(',') : modulesRaw,
            );
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Módulos inválidos');
    }
    await this.purgeShopData(shopId, modules);
    return { ok: true, modules: modulesLabelList(modules) };
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
    if (meta.version && !SUPPORTED_BACKUP_VERSIONS.has(String(meta.version))) {
      throw new BadRequestException(`Versión de backup no soportada: ${meta.version}`);
    }
    const metaShopId = String(meta.shopId ?? '');
    if (metaShopId && metaShopId !== shopId && !force) {
      throw new BadRequestException(
        `El backup es del local ${meta.slug || metaShopId}, no de este. Usá force=1 para forzar.`,
      );
    }

    let modules: BackupModuleId[] | 'all' = 'all';
    if (meta.modules && String(meta.modules).trim() && String(meta.modules) !== 'all') {
      try {
        modules = parseBackupModulesParam(String(meta.modules));
      } catch (e: any) {
        throw new BadRequestException(e?.message ?? 'Módulos del backup inválidos');
      }
    }

    // Dumps v1 no traían shopConfig / customerOrders: no purgar esas tablas al restaurar.
    if (String(meta.version || '1') === '1') {
      const exclude = new Set<BackupModuleId>(['shopConfig', 'customerOrders']);
      if (modules === 'all') {
        modules = expandBackupModules('all').filter((id) => !exclude.has(id));
      } else {
        modules = modules.filter((id) => !exclude.has(id));
      }
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await this.purgeShopDataWithManager(qr.manager, shopId, modules);
      await this.importFromWorkbook(qr.manager, shopId, user.id, wb);
      // Si el dump ya trae A Retirar, no regenerar: dump→purge→restore debe quedar idéntico.
      if (!wb.getWorksheet('cash_pending_withdrawals')) {
        await this.rebuildCashPendingFromClosings(qr.manager, shopId);
      }
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    return { ok: true, modules: modulesLabelList(modules) };
  }

  private async purgeShopData(shopId: string, modules: BackupModuleId[] | 'all' = 'all') {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await this.purgeShopDataWithManager(qr.manager, shopId, modules);
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  /** Hard-delete shop-scoped data for the selected modules (incl. soft-deleted). */
  private async purgeShopDataWithManager(
    manager: any,
    shopId: string,
    modules: BackupModuleId[] | 'all' = 'all',
  ) {
    const steps = purgeStepsForModules(modules);
    const run = async (sql: string) => manager.query(sql, [shopId]);

    for (const step of steps) {
      await this.runPurgeStep(run, step);
    }
  }

  private async runPurgeStep(
    run: (sql: string) => Promise<unknown>,
    step: BackupPurgeStep,
  ): Promise<void> {
    switch (step) {
      case 'pos_sale_ticket_lines':
        await run(
          `DELETE FROM pos_sale_ticket_lines WHERE ticketId IN (SELECT id FROM pos_sale_tickets WHERE shopId = ?)`,
        );
        return;
      case 'pos_sale_tickets':
        await run(`DELETE FROM pos_sale_tickets WHERE shopId = ?`);
        return;
      case 'pos_sale_dailies':
        await run(`DELETE FROM pos_sale_dailies WHERE shopId = ?`);
        return;
      case 'pos_sale_imports':
        await run(`DELETE FROM pos_sale_imports WHERE shopId = ?`);
        return;
      case 'payroll_lines':
        await run(
          `DELETE FROM payroll_lines WHERE periodId IN (SELECT id FROM payroll_periods WHERE shopId = ?)`,
        );
        return;
      case 'payroll_periods':
        await run(`DELETE FROM payroll_periods WHERE shopId = ?`);
        return;
      case 'attendance_days':
        await run(`DELETE FROM attendance_days WHERE shopId = ?`);
        return;
      case 'employee_commission_rules':
        await run(`DELETE FROM employee_commission_rules WHERE shopId = ?`);
        return;
      case 'movements':
        await run(
          `DELETE FROM movements m WHERE m.shopId = ? AND NOT (${this.sqlIsExpense()}) AND NOT (${this.sqlIsIncomeCore()})`,
        );
        return;
      case 'expenses':
        await run(`DELETE FROM movements m WHERE m.shopId = ? AND (${this.sqlIsExpense()})`);
        return;
      case 'incomes':
        await run(
          `DELETE FROM movements m WHERE m.shopId = ? AND NOT (${this.sqlIsExpense()}) AND (${this.sqlIsIncomeCore()})`,
        );
        return;
      case 'payments':
        await run(`DELETE FROM payments WHERE shopId = ?`);
        return;
      case 'closing_expenses':
        await run(
          `DELETE FROM closing_expenses WHERE closingId IN (SELECT id FROM cash_closings WHERE shopId = ?)`,
        );
        return;
      case 'closing_extra_lines':
        await run(
          `DELETE FROM closing_extra_lines WHERE closingId IN (SELECT id FROM cash_closings WHERE shopId = ?)`,
        );
        return;
      case 'cash_closings':
        await run(`DELETE FROM cash_closings WHERE shopId = ?`);
        return;
      case 'ledger_account_users':
        await run(`DELETE FROM ledger_account_users WHERE shopId = ?`);
        return;
      case 'pos_products':
        await run(`DELETE FROM pos_products WHERE shopId = ?`);
        return;
      case 'pos_subcategories':
        await run(`DELETE FROM pos_subcategories WHERE shopId = ?`);
        return;
      case 'pos_categories':
        await run(`DELETE FROM pos_categories WHERE shopId = ?`);
        return;
      case 'concepts':
        await run(`DELETE FROM concepts WHERE shopId = ?`);
        return;
      case 'ledger_accounts':
        await run(`DELETE FROM ledger_accounts WHERE shopId = ?`);
        return;
      case 'employees':
        await run(`DELETE FROM employees WHERE shopId = ?`);
        return;
      case 'tip_allocations':
        await run(
          `DELETE FROM tip_allocations WHERE tipDayId IN (SELECT id FROM tip_days WHERE shopId = ?)`,
        );
        return;
      case 'tip_days':
        await run(`DELETE FROM tip_days WHERE shopId = ?`);
        return;
      case 'order_lines':
        await run(
          `DELETE FROM order_lines WHERE orderId IN (SELECT id FROM orders WHERE shopId = ?)`,
        );
        return;
      case 'orders':
        await run(`DELETE FROM orders WHERE shopId = ?`);
        return;
      case 'shortages':
        await run(`DELETE FROM shortages WHERE shopId = ?`);
        return;
      case 'stock_products_food':
        await run(`DELETE FROM stock_products WHERE shopId = ? AND kind = 'food'`);
        return;
      case 'stock_products_beverage':
        await run(`DELETE FROM stock_products WHERE shopId = ? AND kind = 'beverage'`);
        return;
      case 'stock_categories_food':
        await run(`DELETE FROM stock_categories WHERE shopId = ? AND kind = 'food'`);
        return;
      case 'stock_categories_beverage':
        await run(`DELETE FROM stock_categories WHERE shopId = ? AND kind = 'beverage'`);
        return;
      case 'waiting_list_entries':
        await run(`DELETE FROM waiting_list_entries WHERE shopId = ?`);
        return;
      case 'reservation_requests':
        await run(`DELETE FROM reservation_requests WHERE shopId = ?`);
        return;
      case 'reservations':
        await run(`DELETE FROM reservations WHERE shopId = ?`);
        return;
      case 'reservation_day_notices':
        await run(`DELETE FROM reservation_day_notices WHERE shopId = ?`);
        return;
      case 'salon_tables':
        await run(`DELETE FROM salon_tables WHERE shopId = ?`);
        return;
      case 'salon_map_objects':
        await run(`DELETE FROM salon_map_objects WHERE shopId = ?`);
        return;
      case 'salon_sectors':
        await run(`DELETE FROM salon_sectors WHERE shopId = ?`);
        return;
      case 'salon_area_rules':
        await run(`DELETE FROM salon_area_rules WHERE shopId = ?`);
        return;
      case 'service_rules':
        await run(`DELETE FROM service_rules WHERE shopId = ?`);
        return;
      case 'service_rule_categories':
        await run(`DELETE FROM service_rule_categories WHERE shopId = ?`);
        return;
      case 'reimbursements':
        await run(`DELETE FROM reimbursements WHERE shopId = ?`);
        return;
      case 'production_attendance_days':
        await run(`DELETE FROM production_attendance_days WHERE shopId = ?`);
        return;
      case 'candidates':
        await run(`DELETE FROM candidates WHERE shopId = ?`);
        return;
      case 'cash_pending_withdrawal_offsets':
        await run(`DELETE FROM cash_pending_withdrawal_offsets WHERE shopId = ?`);
        return;
      case 'cash_pending_withdrawals':
        await run(`DELETE FROM cash_pending_withdrawals WHERE shopId = ?`);
        return;
      case 'closing_source_amounts':
        await run(
          `DELETE FROM closing_source_amounts WHERE closingId IN (SELECT id FROM cash_closings WHERE shopId = ?)`,
        );
        return;
      case 'closing_step_files':
        try {
          await run(
            `DELETE FROM closing_step_files WHERE closingId IN (SELECT id FROM cash_closings WHERE shopId = ?)`,
          );
        } catch {
          // tabla todavía no existe
        }
        return;
      case 'settlement_fields':
        await run(
          `UPDATE closing_source_amounts SET settledAt = NULL, settledToAccountId = NULL, settledByUserId = NULL, settledByName = NULL, settlementMovementId = NULL, settleBatchId = NULL WHERE closingId IN (SELECT id FROM cash_closings WHERE shopId = ?)`,
        );
        return;
      case 'shop_closing_sources':
        await run(`DELETE FROM shop_closing_sources WHERE shopId = ?`);
        return;
      case 'partner_split_configs':
        await run(`DELETE FROM partner_split_configs WHERE shopId = ?`);
        return;
      case 'payments_suppliers':
        await run(`DELETE FROM payments WHERE shopId = ? AND supplierId IS NOT NULL`);
        return;
      case 'payments_services':
        await run(`DELETE FROM payments WHERE shopId = ? AND serviceId IS NOT NULL`);
        return;
      case 'payments_employees':
        await run(
          `DELETE FROM payments WHERE shopId = ? AND employeeId IS NOT NULL AND supplierId IS NULL AND serviceId IS NULL`,
        );
        return;
      case 'suppliers':
        await run(`DELETE FROM suppliers WHERE shopId = ?`);
        return;
      case 'services':
        await run(`DELETE FROM services WHERE shopId = ?`);
        return;
      case 'comanda_line_audits':
        try {
          await run(`DELETE FROM comanda_line_audits WHERE shopId = ?`);
        } catch {
          // tabla todavía no existe
        }
        return;
      case 'customer_orders':
        try {
          await run(`DELETE FROM customer_orders WHERE shopId = ?`);
        } catch {
          // tabla todavía no existe
        }
        return;
      case 'table_sessions':
        try {
          await run(`DELETE FROM table_sessions WHERE shopId = ?`);
        } catch {
          // tabla todavía no existe
        }
        return;
      case 'print_jobs':
        try {
          await run(`DELETE FROM print_jobs WHERE shopId = ?`);
        } catch {
          // tabla todavía no existe
        }
        return;
      case 'stock_adjustments_food':
        try {
          await run(
            `DELETE sa FROM stock_adjustments sa INNER JOIN stock_products p ON sa.productId = p.id WHERE sa.shopId = ? AND p.kind = 'food'`,
          );
        } catch {
          // tabla todavía no existe
        }
        return;
      case 'stock_adjustments_beverage':
        try {
          await run(
            `DELETE sa FROM stock_adjustments sa INNER JOIN stock_products p ON sa.productId = p.id WHERE sa.shopId = ? AND p.kind = 'beverage'`,
          );
        } catch {
          // tabla todavía no existe
        }
        return;
      case 'vacations':
        try {
          await run(`DELETE FROM vacations WHERE shopId = ?`);
        } catch {
          // tabla todavía no existe
        }
        return;
      case 'employee_salary_history':
        try {
          await run(`DELETE FROM employee_salary_history WHERE shopId = ?`);
        } catch {
          // tabla todavía no existe
        }
        return;
      case 'partner_split_runs':
        try {
          await run(`DELETE FROM partner_split_runs WHERE shopId = ?`);
        } catch {
          // tabla todavía no existe
        }
        return;
      case 'shop_integrations':
        try {
          await run(`DELETE FROM shop_integrations WHERE shopId = ?`);
        } catch {
          // tabla todavía no existe
        }
        return;
      case 'user_shops':
        await run(`DELETE FROM user_shops WHERE shopId = ?`);
        return;
      default:
        return;
    }
  }

  private sqlIsExpense(): string {
    return `(
      EXISTS (SELECT 1 FROM concepts c WHERE c.id = m.conceptId AND c.kind = 'EXPENSE')
      OR EXISTS (
        SELECT 1 FROM ledger_accounts a
        WHERE a.id = m.toAccountId
          AND (UPPER(IFNULL(a.code, '')) = 'EGRESO' OR LOWER(IFNULL(a.name, '')) LIKE '%egreso%')
      )
    )`;
  }

  private sqlIsIncomeCore(): string {
    return `(
      EXISTS (SELECT 1 FROM concepts c WHERE c.id = m.conceptId AND c.kind = 'INCOME')
      OR EXISTS (
        SELECT 1 FROM ledger_accounts a
        WHERE a.id = m.fromAccountId
          AND (UPPER(IFNULL(a.code, '')) = 'INGRESO' OR LOWER(IFNULL(a.name, '')) LIKE '%ingreso%')
      )
    )`;
  }

  private async collectSheetRows(
    shopId: string,
    sheetSet: Set<BackupSheetName>,
    modules: BackupModuleId[] | 'all' = 'all',
  ): Promise<Map<BackupSheetName, Row[]>> {
    const out = new Map<BackupSheetName, Row[]>();
    const put = (name: BackupSheetName, rows: Row[]) => {
      if (sheetSet.has(name)) out.set(name, rows);
    };

    if (sheetSet.has('ledger_accounts')) {
      const accounts = await this.dataSource.getRepository(LedgerAccount).find({
        where: { shopId, deletedAt: IsNull() },
      });
      put(
        'ledger_accounts',
        accounts.map((a) => ({
          id: a.id,
          name: a.name,
          code: a.code,
          type: a.type,
          linkedPaymentMethod: a.linkedPaymentMethod ?? '',
          hideFromCashWithdraw: a.hideFromCashWithdraw ? 1 : 0,
          listInExpenses: a.listInExpenses === false ? 0 : 1,
          listInIncomes: a.listInIncomes === false ? 0 : 1,
          listInTransfers: a.listInTransfers === false ? 0 : 1,
          listInBalances: a.listInBalances === false ? 0 : 1,
          openingBalance: a.openingBalance ?? 0,
          commissionPercent: a.commissionPercent ?? 0,
          ownershipPercent: a.ownershipPercent ?? 0,
          active: a.active ? 1 : 0,
        })),
      );
    }

    if (sheetSet.has('ledger_account_users')) {
      const accountLinks = await this.dataSource.getRepository(LedgerAccountUser).find({
        where: { shopId },
      });
      put(
        'ledger_account_users',
        accountLinks.map((l) => ({
          id: l.id,
          accountId: l.accountId,
          userId: l.userId,
        })),
      );
    }

    if (sheetSet.has('concepts')) {
      const concepts = await this.dataSource.getRepository(Concept).find({
        where: { shopId, deletedAt: IsNull() },
      });
      put(
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
    }

    if (sheetSet.has('pos_categories')) {
      const categories = await this.dataSource.getRepository(PosCategory).find({
        where: { shopId, deletedAt: IsNull() },
      });
      put(
        'pos_categories',
        categories.map((c) => ({
          id: c.id,
          name: c.name,
          sortOrder: c.sortOrder,
          notes: c.notes ?? '',
          active: c.active ? 1 : 0,
        })),
      );
    }

    if (sheetSet.has('pos_subcategories')) {
      const subcategories = await this.dataSource.getRepository(PosSubcategory).find({
        where: { shopId, deletedAt: IsNull() },
      });
      put(
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
    }

    if (sheetSet.has('pos_products')) {
      const products = await this.dataSource.getRepository(PosProduct).find({
        where: { shopId, deletedAt: IsNull() },
      });
      put(
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
    }

    if (sheetSet.has('employees')) {
      const employees = await this.dataSource.getRepository(Employee).find({
        where: { shopId, deletedAt: IsNull() },
      });
      put(
        'employees',
        employees.map((e) => ({
          id: e.id,
          fullName: e.fullName,
          baseSalary: e.baseSalary,
          overtimeHourRate: e.overtimeHourRate,
          holidayPayMultiplier: e.holidayPayMultiplier ?? '',
          userId: e.userId ?? '',
          hireDate: e.hireDate ?? '',
          notes: e.notes ?? '',
          type: e.type ?? 'FIXED',
          jobRoles: e.jobRoles != null ? JSON.stringify(e.jobRoles) : '',
          shiftAssignments:
            e.shiftAssignments != null ? JSON.stringify(e.shiftAssignments) : '',
          countsForAttendanceBonus: e.countsForAttendanceBonus === false ? 0 : 1,
          producesFood: e.producesFood ? 1 : 0,
          supervisorEmployeeId: e.supervisorEmployeeId ?? '',
          bankAlias: e.bankAlias ?? '',
          serviceCheckIn: e.serviceCheckIn ?? '',
          serviceCheckOut: e.serviceCheckOut ?? '',
          waiterPinHash: e.waiterPinHash ?? '',
          waiterPinPrefix: e.waiterPinPrefix ?? '',
          active: e.active ? 1 : 0,
        })),
      );
    }

    if (sheetSet.has('employee_commission_rules')) {
      const commissionRules = await this.dataSource
        .getRepository(EmployeeCommissionRule)
        .find({ where: { shopId, deletedAt: IsNull() } });
      put(
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
    }

    if (sheetSet.has('attendance_days')) {
      const attendance = await this.dataSource.getRepository(AttendanceDay).find({
        where: { shopId, deletedAt: IsNull() },
      });
      put(
        'attendance_days',
        attendance.map((a) => ({
          id: a.id,
          employeeId: a.employeeId,
          date: a.date,
          shiftId: a.shiftId ?? '',
          isHoliday: a.isHoliday ? 1 : 0,
          isPresent: a.isPresent ? 1 : 0,
          checkInAt: a.checkInAt ?? '',
          checkOutAt: a.checkOutAt ?? '',
          overtimeHours: a.overtimeHours,
          active: a.active ? 1 : 0,
        })),
      );
    }

    let periods: PayrollPeriod[] = [];
    if (sheetSet.has('payroll_periods') || sheetSet.has('payroll_lines')) {
      periods = await this.dataSource.getRepository(PayrollPeriod).find({
        where: { shopId, deletedAt: IsNull() },
      });
    }
    if (sheetSet.has('payroll_periods')) {
      put(
        'payroll_periods',
        periods.map((p) => ({
          id: p.id,
          year: p.year,
          month: p.month,
          fromDate: p.fromDate ?? '',
          toDate: p.toDate ?? '',
          status: p.status,
          active: p.active ? 1 : 0,
        })),
      );
    }
    if (sheetSet.has('payroll_lines')) {
      const periodIds = periods.map((p) => p.id);
      const payrollLinesFixed = periodIds.length
        ? await this.dataSource
            .getRepository(PayrollLine)
            .createQueryBuilder('l')
            .where('l.periodId IN (:...ids)', { ids: periodIds })
            .getMany()
        : [];
      put(
        'payroll_lines',
        payrollLinesFixed.map((l) => ({
          id: l.id,
          periodId: l.periodId,
          employeeId: l.employeeId,
          shiftId: l.shiftId ?? '',
          shiftName: l.shiftName ?? '',
          daysWorked: l.daysWorked,
          hoursWorked: l.hoursWorked,
          holidayDays: l.holidayDays,
          baseSalarySnapshot: l.baseSalarySnapshot,
          holidayMultiplierSnapshot: l.holidayMultiplierSnapshot ?? '',
          overtimeAmount: l.overtimeAmount,
          attendanceBonus: l.attendanceBonus,
          total: l.total,
          notes: l.notes ?? '',
          active: l.active ? 1 : 0,
        })),
      );
    }

    let closings: CashClosing[] = [];
    if (
      sheetSet.has('cash_closings') ||
      sheetSet.has('closing_expenses') ||
      sheetSet.has('closing_extra_lines')
    ) {
      closings = await this.dataSource.getRepository(CashClosing).find({
        where: { shopId, deletedAt: IsNull() },
      });
    }
    if (sheetSet.has('cash_closings')) {
      put(
        'cash_closings',
        closings.map((c) => this.closingToRow(c)),
      );
    }
    const closingIds = closings.map((c) => c.id);
    if (sheetSet.has('closing_expenses')) {
      const expenses = closingIds.length
        ? await this.dataSource
            .getRepository(ClosingExpense)
            .createQueryBuilder('e')
            .where('e.closingId IN (:...ids)', { ids: closingIds })
            .getMany()
        : [];
      put(
        'closing_expenses',
        expenses.map((e) => ({
          id: e.id,
          closingId: e.closingId,
          label: e.label,
          amount: e.amount,
          category: e.category,
        })),
      );
    }
    if (sheetSet.has('closing_extra_lines')) {
      const extras = closingIds.length
        ? await this.dataSource
            .getRepository(ClosingExtraLine)
            .createQueryBuilder('e')
            .where('e.closingId IN (:...ids)', { ids: closingIds })
            .getMany()
        : [];
      put(
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
    }

    if (sheetSet.has('movements')) {
      const slices = movementSlicesForModules(modules);
      const movements = await this.dataSource.getRepository(Movement).find({
        where: { shopId, deletedAt: IsNull() },
      });
      const conceptIds = [
        ...new Set(movements.map((m) => m.conceptId).filter((id): id is string => !!id)),
      ];
      const accountIds = [
        ...new Set(
          movements.flatMap((m) => [m.fromAccountId, m.toAccountId]).filter((id): id is string => !!id),
        ),
      ];
      const concepts = conceptIds.length
        ? await this.dataSource.getRepository(Concept).find({ where: { id: In(conceptIds) } })
        : [];
      const accounts = accountIds.length
        ? await this.dataSource.getRepository(LedgerAccount).find({ where: { id: In(accountIds) } })
        : [];
      const conceptById = new Map(concepts.map((c) => [c.id, c]));
      const accountById = new Map(accounts.map((a) => [a.id, a]));
      const filtered = movements.filter((m) => {
        const concept = m.conceptId ? conceptById.get(m.conceptId) : undefined;
        const from = m.fromAccountId ? accountById.get(m.fromAccountId) : undefined;
        const to = m.toAccountId ? accountById.get(m.toAccountId) : undefined;
        return slices.has(
          classifyBackupMovement({
            conceptKind: concept?.kind,
            fromAccountName: from?.name,
            fromAccountCode: from?.code,
            toAccountName: to?.name,
            toAccountCode: to?.code,
            toAccountType: to?.type,
          }),
        );
      });
      put(
        'movements',
        filtered.map((m) => ({
          id: m.id,
          businessDate: m.businessDate,
          fromAccountId: m.fromAccountId,
          toAccountId: m.toAccountId,
          fromUserId: m.fromUserId ?? '',
          toUserId: m.toUserId ?? '',
          beneficiaryAccountId: m.beneficiaryAccountId ?? '',
          description: m.description ?? '',
          amountUyu: m.amountUyu,
          usdRate: m.usdRate ?? '',
          amountUsd: m.amountUsd ?? '',
          conceptId: m.conceptId ?? '',
          invoiced: m.invoiced ? 1 : 0,
          invoiceNumber: m.invoiceNumber ?? '',
          closingId: m.closingId ?? '',
          employeeId: m.employeeId ?? '',
          paymentMethod: m.paymentMethod ?? '',
          receiptFilePath: m.receiptFilePath ?? '',
          receiptFileName: m.receiptFileName ?? '',
          receiptFileMime: m.receiptFileMime ?? '',
          active: m.active ? 1 : 0,
        })),
      );
    }

    if (sheetSet.has('pos_sale_imports')) {
      const imports = await this.dataSource.getRepository(PosSaleImport).find({
        where: { shopId, deletedAt: IsNull() },
      });
      put(
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
    }

    let tickets: PosSaleTicket[] = [];
    if (sheetSet.has('pos_sale_tickets') || sheetSet.has('pos_sale_ticket_lines')) {
      tickets = await this.dataSource.getRepository(PosSaleTicket).find({
        where: { shopId, deletedAt: IsNull() },
      });
    }
    if (sheetSet.has('pos_sale_tickets')) {
      put(
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
    }
    if (sheetSet.has('pos_sale_ticket_lines')) {
      const ticketIds = tickets.map((t) => t.id);
      const ticketLines = ticketIds.length
        ? await this.dataSource
            .getRepository(PosSaleTicketLine)
            .createQueryBuilder('l')
            .where('l.ticketId IN (:...ids)', { ids: ticketIds })
            .getMany()
        : [];
      put(
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
    }

    if (sheetSet.has('pos_sale_dailies')) {
      const dailies = await this.dataSource.getRepository(PosSaleDaily).find({
        where: { shopId, deletedAt: IsNull() },
      });
      put(
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
    }

    await this.collectExtraSheetRows(shopId, sheetSet, modules, put);
    return out;
  }

  private buildSqlDump(opts: {
    shopId: string;
    slug: string;
    name: string;
    modules: string;
    sheets: Map<BackupSheetName, Row[]>;
  }): string {
    const lines: string[] = [
      `-- Cash Register Closings shop backup`,
      `-- version: ${BACKUP_VERSION}`,
      `-- shopId: ${opts.shopId}`,
      `-- slug: ${opts.slug}`,
      `-- name: ${opts.name.replace(/\n/g, ' ')}`,
      `-- modules: ${opts.modules}`,
      `-- exportedAt: ${new Date().toISOString()}`,
      `-- Solo exportación (no ejecutar restore automático desde la UI).`,
      ``,
    ];
    for (const [table, rows] of opts.sheets) {
      lines.push(`-- table: ${table} (${rows.length} rows)`);
      if (!rows.length) {
        lines.push(`-- (empty)`);
        lines.push('');
        continue;
      }
      const keys = Object.keys(rows[0]!);
      for (const row of rows) {
        const cols = keys.map((k) => `\`${k}\``).join(', ');
        const vals = keys.map((k) => this.sqlLiteral(row[k])).join(', ');
        lines.push(`INSERT INTO \`${table}\` (${cols}) VALUES (${vals});`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  private sqlLiteral(v: unknown): string {
    if (v === null || v === undefined || v === '') return 'NULL';
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (v instanceof Date) {
      const s = this.toMysqlDateTime(v).replace(/\\/g, '\\\\').replace(/'/g, "''");
      return `'${s}'`;
    }
    if (typeof v === 'string') {
      const asDt = this.coerceMysqlDateTime(v);
      if (asDt != null) {
        const s = asDt.replace(/\\/g, '\\\\').replace(/'/g, "''");
        return `'${s}'`;
      }
    }
    const s = String(v).replace(/\\/g, '\\\\').replace(/'/g, "''");
    return `'${s}'`;
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
          hideFromCashWithdraw: this.toBool(r.hideFromCashWithdraw, false),
          listInExpenses: this.toBool(r.listInExpenses, true),
          listInIncomes: this.toBool(r.listInIncomes, true),
          listInTransfers: this.toBool(r.listInTransfers, true),
          listInBalances: this.toBool(r.listInBalances, true),
          openingBalance: String(r.openingBalance ?? 0),
          commissionPercent: String(r.commissionPercent ?? 0),
          ownershipPercent: String(r.ownershipPercent ?? 0),
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
          overtimeHourRate: String(r.overtimeHourRate ?? '0'),
          holidayPayMultiplier: this.emptyToNull(r.holidayPayMultiplier),
          userId: userId && existingUserIds.has(userId) ? userId : null,
          hireDate: this.emptyToNull(r.hireDate),
          notes: this.emptyToNull(r.notes),
          type: (String(r.type ?? 'FIXED') === 'ROTATING' ? 'ROTATING' : 'FIXED') as any,
          jobRoles: this.parseJsonField(r.jobRoles) as any,
          shiftAssignments: this.parseJsonField(r.shiftAssignments) as any,
          countsForAttendanceBonus: this.toBool(r.countsForAttendanceBonus, true),
          producesFood: this.toBool(r.producesFood, false),
          supervisorEmployeeId: null,
          bankAlias: this.emptyToNull(r.bankAlias),
          serviceCheckIn: this.emptyToNull(r.serviceCheckIn),
          serviceCheckOut: this.emptyToNull(r.serviceCheckOut),
          waiterPinHash: this.emptyToNull(r.waiterPinHash),
          waiterPinPrefix: this.emptyToNull(r.waiterPinPrefix),
          active: this.toBool(r.active, true),
        }),
      );
    }
    // Segunda pasada: supervisorEmployeeId ya está en el map.
    for (const r of this.readRowsSheet(wb, 'employees')) {
      const empId = mapId(String(r.id));
      const supervisorId = mapId(this.emptyToNull(r.supervisorEmployeeId) ?? undefined);
      if (!empId || !supervisorId) continue;
      await manager.query(`UPDATE employees SET supervisorEmployeeId = ? WHERE id = ?`, [
        supervisorId,
        empId,
      ]);
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
          shiftId: this.emptyToNull(r.shiftId),
          isHoliday: this.toBool(r.isHoliday, false),
          isPresent: this.toBool(r.isPresent, false),
          checkInAt: this.emptyToNull(r.checkInAt),
          checkOutAt: this.emptyToNull(r.checkOutAt),
          overtimeHours: String(r.overtimeHours ?? '0'),
          active: this.toBool(r.active, true),
        }),
      );
    }

    for (const r of this.readRowsSheet(wb, 'payroll_periods')) {
      const year = Number(r.year);
      const month = Number(r.month);
      const fromFallback = `${year}-${String(month).padStart(2, '0')}-01`;
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const toFallback = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
      await manager.getRepository(PayrollPeriod).save(
        manager.getRepository(PayrollPeriod).create({
          id: newId(String(r.id)),
          shopId,
          year,
          month,
          fromDate: this.emptyToNull(r.fromDate) || fromFallback,
          toDate: this.emptyToNull(r.toDate) || toFallback,
          status: r.status as any,
          active: this.toBool(r.active, true),
        }),
      );
    }

    const payrollLineKeys = new Set<string>();
    for (const r of this.readRowsSheet(wb, 'payroll_lines')) {
      const periodId = mapId(String(r.periodId));
      const employeeId = mapId(String(r.employeeId));
      if (!periodId || !employeeId) continue;
      let shiftId = String(r.shiftId ?? '').trim();
      const key = `${periodId}\0${employeeId}\0${shiftId}`;
      if (payrollLineKeys.has(key)) {
        // Dump viejo sin columna shiftId: varias líneas del mismo empleado colapsaban a ''.
        shiftId = `imp-${String(r.id ?? randomUUID()).replace(/-/g, '').slice(0, 32)}`;
      }
      payrollLineKeys.add(`${periodId}\0${employeeId}\0${shiftId}`);
      await manager.getRepository(PayrollLine).save(
        manager.getRepository(PayrollLine).create({
          id: newId(String(r.id)),
          periodId,
          employeeId,
          shiftId,
          shiftName: this.emptyToNull(r.shiftName),
          daysWorked: String(r.daysWorked ?? '0'),
          hoursWorked: String(r.hoursWorked ?? '0'),
          holidayDays: String(r.holidayDays ?? '0'),
          baseSalarySnapshot: String(r.baseSalarySnapshot ?? '0'),
          holidayMultiplierSnapshot: this.emptyToNull(r.holidayMultiplierSnapshot),
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
      const kind = String(r.kind ?? 'REGULAR') === 'EVENT' ? 'EVENT' : 'REGULAR';
      const eventName = this.emptyToNull(r.eventName);
      await manager.getRepository(CashClosing).save(
        manager.getRepository(CashClosing).create({
          id,
          shopId,
          businessDate,
          businessDateKey:
            kind === 'EVENT'
              ? closingEventDateKey(businessDate, id)
              : closingDateKey(businessDate, String(r.shiftId ?? '') || null),
          shiftId: this.emptyToNull(r.shiftId),
          shiftName: this.emptyToNull(r.shiftName),
          kind,
          eventName,
          posSystemAmount: String(r.posSystemAmount ?? '0'),
          cardAmount: String(r.cardAmount ?? '0'),
          cashAmount: String(r.cashAmount ?? '0'),
          mercadoPagoAmount: String(r.mercadoPagoAmount ?? '0'),
          deliveryAppsAmount: String(r.deliveryAppsAmount ?? '0'),
          transferAmount: String(r.transferAmount ?? '0'),
          accountDniAmount: String(r.accountDniAmount ?? '0'),
          otherAmount: String(r.otherAmount ?? '0'),
          posnetAmounts: this.parseJsonField(r.posnetAmounts) as any,
          unitsSold: this.emptyToNull(r.unitsSold) != null ? Number(r.unitsSold) : null,
          coversCount: this.emptyToNull(r.coversCount) != null ? Number(r.coversCount) : null,
          averageTicket: this.emptyToNull(r.averageTicket),
          cashOpeningAmount: String(r.cashOpeningAmount ?? '0'),
          cashLeftInRegister: String(r.cashLeftInRegister ?? '0'),
          cashPendingPickup: String(r.cashPendingPickup ?? '0'),
          cashWithdrawn: String(r.cashWithdrawn ?? '0'),
          cashWithdrawnByUserId: (() => {
            const u = this.emptyToNull(r.cashWithdrawnByUserId);
            return u && existingUserIds.has(u) ? u : null;
          })(),
          cashWithdrawnByEmployeeId: mapId(this.emptyToNull(r.cashWithdrawnByEmployeeId) ?? undefined),
          cashWithdrawnByName: this.emptyToNull(r.cashWithdrawnByName),
          cashWithdrawnToAccountId: mapId(
            this.emptyToNull(r.cashWithdrawnToAccountId) ?? undefined,
          ),
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
          fromUserId: pickUser(this.emptyToNull(r.fromUserId)),
          toUserId: pickUser(this.emptyToNull(r.toUserId)),
          beneficiaryAccountId: mapId(this.emptyToNull(r.beneficiaryAccountId) ?? undefined),
          description: this.emptyToNull(r.description),
          amountUyu: String(r.amountUyu ?? '0'),
          usdRate: this.emptyToNull(r.usdRate),
          amountUsd: this.emptyToNull(r.amountUsd),
          conceptId: mapId(this.emptyToNull(r.conceptId) ?? undefined),
          invoiced: this.toBool(r.invoiced, false),
          invoiceNumber: this.emptyToNull(r.invoiceNumber),
          closingId: mapId(this.emptyToNull(r.closingId) ?? undefined),
          employeeId: mapId(this.emptyToNull(r.employeeId) ?? undefined),
          paymentMethod: this.emptyToNull(r.paymentMethod),
          receiptFilePath: this.emptyToNull(r.receiptFilePath),
          receiptFileName: this.emptyToNull(r.receiptFileName),
          receiptFileMime: this.emptyToNull(r.receiptFileMime),
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

    await this.importExtraSheets(manager, shopId, actorUserId, wb, map);
    await this.importShopConfig(manager, shopId, wb, map, existingUserIds);
  }

  private closingToRow(c: CashClosing): Row {
    return {
      id: c.id,
      businessDate: c.businessDate,
      businessDateKey: c.businessDateKey ?? '',
      shiftId: c.shiftId ?? '',
      shiftName: c.shiftName ?? '',
      kind: c.kind ?? 'REGULAR',
      eventName: c.eventName ?? '',
      posSystemAmount: c.posSystemAmount,
      cardAmount: c.cardAmount,
      cashAmount: c.cashAmount,
      mercadoPagoAmount: c.mercadoPagoAmount,
      deliveryAppsAmount: c.deliveryAppsAmount,
      transferAmount: c.transferAmount,
      accountDniAmount: c.accountDniAmount,
      otherAmount: c.otherAmount,
      posnetAmounts: c.posnetAmounts != null ? JSON.stringify(c.posnetAmounts) : '',
      unitsSold: c.unitsSold ?? '',
      coversCount: c.coversCount ?? '',
      averageTicket: c.averageTicket ?? '',
      cashOpeningAmount: c.cashOpeningAmount ?? '0',
      cashLeftInRegister: c.cashLeftInRegister,
      cashPendingPickup: c.cashPendingPickup,
      cashWithdrawn: c.cashWithdrawn,
      cashWithdrawnByUserId: c.cashWithdrawnByUserId ?? '',
      cashWithdrawnByEmployeeId: c.cashWithdrawnByEmployeeId ?? '',
      cashWithdrawnByName: c.cashWithdrawnByName ?? '',
      cashWithdrawnToAccountId: c.cashWithdrawnToAccountId ?? '',
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
        if (val instanceof Date) val = this.toMysqlDateTime(val);
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

  private async collectExtraSheetRows(
    shopId: string,
    sheetSet: Set<BackupSheetName>,
    modules: BackupModuleId[] | 'all',
    put: (name: BackupSheetName, rows: Row[]) => void,
  ) {
    const ids = expandBackupModules(modules);
    const has = (id: BackupModuleId) => modules === 'all' || ids.includes(id);

    const dump = (table: string, extra = '') => this.dumpShopTable(table, shopId, extra);
    const dumpVia = (sql: string) => this.dumpSql(sql, [shopId]);

    if (sheetSet.has('shop_closing_sources')) put('shop_closing_sources', await dump('shop_closing_sources'));
    if (sheetSet.has('closing_source_amounts')) {
      put(
        'closing_source_amounts',
        await dumpVia(
          `SELECT a.* FROM closing_source_amounts a INNER JOIN cash_closings c ON a.closingId = c.id WHERE c.shopId = ?`,
        ),
      );
    }
    if (sheetSet.has('cash_pending_withdrawals')) {
      put('cash_pending_withdrawals', await dump('cash_pending_withdrawals'));
    }
    if (sheetSet.has('cash_pending_withdrawal_offsets')) {
      put('cash_pending_withdrawal_offsets', await dump('cash_pending_withdrawal_offsets'));
    }
    if (sheetSet.has('payments')) {
      const parts: string[] = [];
      if (has('paymentsSuppliers')) parts.push('supplierId IS NOT NULL');
      if (has('paymentsServices')) parts.push('serviceId IS NOT NULL');
      if (has('paymentsEmployees')) {
        parts.push(`(employeeId IS NOT NULL AND supplierId IS NULL AND serviceId IS NULL)`);
      }
      const extra = parts.length && parts.length < 3 ? parts.join(' OR ') : '';
      put('payments', await dump('payments', extra));
    }
    if (sheetSet.has('partner_split_configs')) put('partner_split_configs', await dump('partner_split_configs'));
    if (sheetSet.has('partner_split_runs')) {
      try {
        put('partner_split_runs', await dump('partner_split_runs'));
      } catch {
        put('partner_split_runs', []);
      }
    }
    if (sheetSet.has('suppliers')) put('suppliers', await dump('suppliers'));
    if (sheetSet.has('services')) put('services', await dump('services'));
    if (sheetSet.has('reservations')) put('reservations', await dump('reservations'));
    if (sheetSet.has('reservation_requests')) put('reservation_requests', await dump('reservation_requests'));
    if (sheetSet.has('reservation_day_notices')) {
      put('reservation_day_notices', await dump('reservation_day_notices'));
    }
    if (sheetSet.has('waiting_list_entries')) put('waiting_list_entries', await dump('waiting_list_entries'));
    if (sheetSet.has('salon_sectors')) put('salon_sectors', await dump('salon_sectors'));
    if (sheetSet.has('salon_tables')) put('salon_tables', await dump('salon_tables'));
    if (sheetSet.has('salon_map_objects')) put('salon_map_objects', await dump('salon_map_objects'));
    if (sheetSet.has('salon_area_rules')) put('salon_area_rules', await dump('salon_area_rules'));
    if (sheetSet.has('table_sessions')) {
      try {
        put('table_sessions', await dump('table_sessions'));
      } catch {
        put('table_sessions', []);
      }
    }
    if (sheetSet.has('customer_orders')) {
      try {
        put('customer_orders', await dump('customer_orders'));
      } catch {
        put('customer_orders', []);
      }
    }
    if (sheetSet.has('comanda_line_audits')) {
      try {
        put('comanda_line_audits', await dump('comanda_line_audits'));
      } catch {
        put('comanda_line_audits', []);
      }
    }
    if (sheetSet.has('stock_categories') || sheetSet.has('stock_products') || sheetSet.has('stock_adjustments')) {
      const kinds: string[] = [];
      if (has('stock')) kinds.push('food');
      if (has('beverageStock')) kinds.push('beverage');
      const kindSql =
        kinds.length === 1 ? `kind = '${kinds[0]}'` : '';
      if (sheetSet.has('stock_categories')) {
        put('stock_categories', await dump('stock_categories', kindSql));
      }
      if (sheetSet.has('stock_products')) {
        put('stock_products', await dump('stock_products', kindSql));
      }
      if (sheetSet.has('stock_adjustments')) {
        try {
          if (kinds.length === 1) {
            put(
              'stock_adjustments',
              await dumpVia(
                `SELECT a.* FROM stock_adjustments a INNER JOIN stock_products p ON a.productId = p.id WHERE a.shopId = ? AND p.kind = '${kinds[0]}'`,
              ),
            );
          } else {
            put('stock_adjustments', await dump('stock_adjustments'));
          }
        } catch {
          put('stock_adjustments', []);
        }
      }
    }
    if (sheetSet.has('shortages')) put('shortages', await dump('shortages'));
    if (sheetSet.has('orders')) put('orders', await dump('orders'));
    if (sheetSet.has('order_lines')) put('order_lines', await dump('order_lines'));
    if (sheetSet.has('candidates')) put('candidates', await dump('candidates'));
    if (sheetSet.has('production_attendance_days')) {
      put('production_attendance_days', await dump('production_attendance_days'));
    }
    if (sheetSet.has('vacations')) {
      try {
        put('vacations', await dump('vacations'));
      } catch {
        put('vacations', []);
      }
    }
    if (sheetSet.has('employee_salary_history')) {
      try {
        put('employee_salary_history', await dump('employee_salary_history'));
      } catch {
        put('employee_salary_history', []);
      }
    }
    if (sheetSet.has('tip_days')) put('tip_days', await dump('tip_days'));
    if (sheetSet.has('tip_allocations')) {
      put(
        'tip_allocations',
        await dumpVia(
          `SELECT a.* FROM tip_allocations a INNER JOIN tip_days d ON a.tipDayId = d.id WHERE d.shopId = ?`,
        ),
      );
    }
    if (sheetSet.has('reimbursements')) put('reimbursements', await dump('reimbursements'));
    if (sheetSet.has('service_rule_categories')) {
      put('service_rule_categories', await dump('service_rule_categories'));
    }
    if (sheetSet.has('service_rules')) put('service_rules', await dump('service_rules'));
    if (sheetSet.has('closing_step_files')) {
      try {
        put(
          'closing_step_files',
          await dumpVia(
            `SELECT f.* FROM closing_step_files f INNER JOIN cash_closings c ON f.closingId = c.id WHERE c.shopId = ?`,
          ),
        );
      } catch {
        put('closing_step_files', []);
      }
    }
    if (sheetSet.has('shop')) {
      put('shop', await this.dumpSql(`SELECT * FROM shops WHERE id = ?`, [shopId]));
    }
    if (sheetSet.has('shop_integrations')) {
      try {
        put('shop_integrations', await dump('shop_integrations'));
      } catch {
        put('shop_integrations', []);
      }
    }
    if (sheetSet.has('user_shops')) {
      put('user_shops', await dump('user_shops'));
    }
  }

  private async dumpShopTable(table: string, shopId: string, extra = ''): Promise<Row[]> {
    const soft = await this.tableHasDeletedAt(table);
    const deletedClause = soft ? ' AND deletedAt IS NULL' : '';
    const sql = extra
      ? `SELECT * FROM \`${table}\` WHERE shopId = ?${deletedClause} AND (${extra})`
      : `SELECT * FROM \`${table}\` WHERE shopId = ?${deletedClause}`;
    return this.dumpSql(sql, [shopId]);
  }

  private async tableHasDeletedAt(table: string): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'deletedAt'`,
      [table],
    )) as Array<{ c: number }>;
    return Number(rows?.[0]?.c ?? 0) > 0;
  }

  private async dumpSql(sql: string, params: unknown[]): Promise<Row[]> {
    const rows = (await this.dataSource.query(sql, params)) as Record<string, unknown>[];
    return (rows ?? []).map((r) => this.normalizeDumpRow(r));
  }

  private normalizeDumpRow(r: Record<string, unknown>): Row {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      // MySQL DATETIME no acepta ISO con "T"/"Z" en INSERT crudo al restaurar.
      if (v instanceof Date) out[k] = this.toMysqlDateTime(v);
      else if (Buffer.isBuffer(v)) out[k] = v.toString('utf8');
      else if (v && typeof v === 'object') out[k] = JSON.stringify(v);
      else out[k] = v ?? '';
    }
    return out;
  }

  private async importExtraSheets(
    manager: any,
    shopId: string,
    actorUserId: string,
    wb: ExcelJS.Workbook,
    map: Map<string, string>,
  ) {
    const existingUserIds = new Set(
      (await this.users.find({ select: ['id'] })).map((u) => u.id),
    );
    const remap = (oldId: string | null | undefined) => {
      if (!oldId) return null;
      return map.get(oldId) ?? null;
    };
    const ensureId = (oldId: string) => {
      const existing = map.get(oldId);
      if (existing) return existing;
      const id = randomUUID();
      map.set(oldId, id);
      return id;
    };
    const tables: BackupSheetName[] = [
      'shop_closing_sources',
      'closing_source_amounts',
      'cash_pending_withdrawals',
      'cash_pending_withdrawal_offsets',
      'suppliers',
      'services',
      'partner_split_configs',
      'partner_split_runs',
      'salon_sectors',
      'salon_tables',
      'salon_map_objects',
      'salon_area_rules',
      'table_sessions',
      'customer_orders',
      'comanda_line_audits',
      'reservations',
      'reservation_day_notices',
      'reservation_requests',
      'waiting_list_entries',
      'stock_categories',
      'stock_products',
      'stock_adjustments',
      'shortages',
      'orders',
      'order_lines',
      'candidates',
      'production_attendance_days',
      'vacations',
      'employee_salary_history',
      'tip_days',
      'tip_allocations',
      'reimbursements',
      'service_rule_categories',
      'service_rules',
      'closing_step_files',
      'payments',
      'shop_integrations',
      'user_shops',
    ];
    /** FKs a entidades remapeadas en este dump. Si no hay map, se anulan (opcionales) o se salta la fila. */
    const requiredFkByTable: Partial<Record<BackupSheetName, string[]>> = {
      cash_pending_withdrawals: ['closingId'],
      cash_pending_withdrawal_offsets: ['pendingId'],
      closing_source_amounts: ['closingId', 'sourceId'],
      order_lines: ['orderId'],
      tip_allocations: ['tipDayId'],
      salon_tables: ['sectorId'],
      table_sessions: ['salonTableId'],
      stock_adjustments: ['productId'],
      employee_salary_history: ['employeeId'],
      closing_step_files: ['closingId'],
      comanda_line_audits: ['tableSessionId'],
    };
    const fkCols = [
      'accountId',
      'fromAccountId',
      'toAccountId',
      'pickedToAccountId',
      'settledToAccountId',
      'conceptId',
      'employeeId',
      'closingId',
      'movementId',
      'settlementMovementId',
      'supplierId',
      'serviceId',
      'categoryId',
      'productId',
      'shortageId',
      'orderId',
      'tipDayId',
      'pendingId',
      'sourceId',
      'reservationId',
      'supervisorEmployeeId',
      'sectorId',
      'importId',
      'ticketId',
      'waiterEmployeeId',
      'salonTableId',
      'openSalonTableId',
      'tableSessionId',
      'customerOrderId',
      'partnerAccountId',
      'closingAccountId',
      'closingSourceId',
      'paymentAccountId',
      'actorEmployeeId',
    ];
    const userFkCols = [
      'pickedByUserId',
      'confirmedByUserId',
      'settledByUserId',
      'createdByUserId',
      'userId',
      'payerUserId',
      'validatorUserId',
      'validatedByUserId',
      'appliedByUserId',
    ];
    const errors: string[] = [];
    let inserted = 0;
    let skipped = 0;

    for (const table of tables) {
      const rows = this.readRowsSheet(wb, table);
      // Hojas de membresía/integración: si vienen en el Excel, reemplazar el estado del local.
      if (
        (table === 'user_shops' || table === 'shop_integrations') &&
        wb.getWorksheet(table)
      ) {
        await manager.query(`DELETE FROM \`${table}\` WHERE shopId = ?`, [shopId]);
      }
      const required = new Set(requiredFkByTable[table] ?? []);
      for (const r of rows) {
        const row: Record<string, unknown> = { ...r };
        if (row.id) row.id = ensureId(String(r.id));
        if ('shopId' in row) row.shopId = shopId;
        if ('deletedAt' in row) row.deletedAt = null;
        if ('active' in row) row.active = this.toBool(row.active, true) ? 1 : 0;

        if (table === 'user_shops') {
          const uid = String(r.userId ?? '');
          if (!uid || !existingUserIds.has(uid)) {
            skipped += 1;
            continue;
          }
          row.userId = uid;
          row.shopId = shopId;
        }

        let skip = false;
        for (const col of fkCols) {
          if (row[col] == null || String(row[col]) === '') continue;
          const mapped = remap(String(row[col]));
          if (mapped) {
            row[col] = mapped;
            continue;
          }
          if (required.has(col)) {
            skip = true;
            break;
          }
          row[col] = null;
        }
        if (skip) {
          skipped += 1;
          continue;
        }

        for (const col of userFkCols) {
          if (table === 'user_shops' && col === 'userId') continue;
          if (row[col] == null || String(row[col]) === '') continue;
          const uid = String(row[col]);
          if (!existingUserIds.has(uid)) {
            row[col] = col === 'createdByUserId' ? actorUserId : null;
          }
        }

        if (table === 'partner_split_configs') {
          row.partnerAccountIds = this.remapJsonIds(row.partnerAccountIds, map);
          row.channelLeaves = this.remapChannelLeaves(row.channelLeaves, map);
        }
        if (table === 'partner_split_runs' && row.snapshot != null) {
          row.snapshot = this.remapIdsInJsonTree(row.snapshot, map);
        }
        if (
          (table === 'table_sessions' || table === 'customer_orders') &&
          row.payments != null
        ) {
          row.payments = this.remapPaymentsJson(row.payments, map);
        }
        const cols = Object.keys(row).filter((k) => row[k] !== undefined);
        if (!cols.length) continue;
        const placeholders = cols.map(() => '?').join(', ');
        const sql = `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${placeholders})`;
        try {
          await manager.query(
            sql,
            cols.map((c) => this.sqlValue(row[c])),
          );
          inserted += 1;
        } catch (err) {
          skipped += 1;
          const msg = (err as Error)?.message ?? String(err);
          if (errors.length < 8) {
            errors.push(`${table}: ${msg.slice(0, 180)}`);
          }
        }
      }
    }

    if (errors.length && inserted === 0 && skipped > 0) {
      throw new BadRequestException(
        `No se pudo importar datos auxiliares (${skipped} filas). ${errors[0]}`,
      );
    }
    if (errors.length) {
      // Restore parcial de hojas extra: no abortar si lo principal ya entró.
      // Los errores quedan en el mensaje vía logger del caller si hace falta.
    }
    void skipped;
    void inserted;
  }

  /**
   * Actualiza la fila `shops` del destino con la config del dump (sin cambiar id).
   * Solo si existe la hoja `shop` (módulo shopConfig / dump completo).
   */
  private async importShopConfig(
    manager: any,
    shopId: string,
    wb: ExcelJS.Workbook,
    map: Map<string, string>,
    existingUserIds: Set<string>,
  ) {
    const rows = this.readRowsSheet(wb, 'shop');
    if (!rows.length) return;
    const src = { ...rows[0]! };
    delete src.id;
    delete src.createdAt;
    delete src.updatedAt;
    delete src.deletedAt;

    if (src.cashWithdrawalConceptId != null && String(src.cashWithdrawalConceptId) !== '') {
      const mapped = map.get(String(src.cashWithdrawalConceptId));
      src.cashWithdrawalConceptId = mapped ?? null;
    }
    if (src.partnerDividendConceptId != null && String(src.partnerDividendConceptId) !== '') {
      const mapped = map.get(String(src.partnerDividendConceptId));
      src.partnerDividendConceptId = mapped ?? null;
    }
    if (src.partnerDividendAccountId != null && String(src.partnerDividendAccountId) !== '') {
      const mapped = map.get(String(src.partnerDividendAccountId));
      src.partnerDividendAccountId = mapped ?? null;
    }
    // salesSystemId del dump puede ser de otro entorno: no romper FK al restaurar.
    if (src.salesSystemId != null && String(src.salesSystemId).trim() !== '') {
      const sid = String(src.salesSystemId).trim();
      const rows = (await manager.query(
        `SELECT id FROM sales_systems WHERE id = ? LIMIT 1`,
        [sid],
      )) as Array<{ id: string }>;
      if (!rows?.length) src.salesSystemId = null;
    } else {
      src.salesSystemId = null;
    }
    if (src.tablePaymentMethods != null) {
      src.tablePaymentMethods = this.remapAccountIdInJsonArray(src.tablePaymentMethods, map);
    }
    if (src.orderingPayments != null) {
      src.orderingPayments = this.remapOrderingPayments(src.orderingPayments, map);
    }
    if (src.promos != null) {
      src.promos = this.remapAccountIdInJsonArray(src.promos, map);
    }
    if (src.emailNotificationUserIds != null) {
      src.emailNotificationUserIds = this.filterExistingUserIdsJson(
        src.emailNotificationUserIds,
        existingUserIds,
      );
    }

    const cols = Object.keys(src).filter((k) => src[k] !== undefined);
    if (!cols.length) return;
    const sets = cols.map((c) => `\`${c}\` = ?`).join(', ');
    await manager.query(
      `UPDATE shops SET ${sets} WHERE id = ?`,
      [...cols.map((c) => this.sqlValue(src[c])), shopId],
    );
  }

  private parseJsonField(raw: unknown): unknown {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'object') return raw;
    const s = String(raw).trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  private remapAccountIdInJsonArray(raw: unknown, map: Map<string, string>): string {
    let items: Array<Record<string, unknown>> = [];
    if (typeof raw === 'string' && raw.trim()) {
      try {
        items = JSON.parse(raw);
      } catch {
        items = [];
      }
    } else if (Array.isArray(raw)) items = raw as Array<Record<string, unknown>>;
    return JSON.stringify(
      items.map((i) => {
        if (!i || typeof i !== 'object') return i;
        const accountId = i.accountId != null ? String(i.accountId) : '';
        if (!accountId) return i;
        return { ...i, accountId: map.get(accountId) ?? accountId };
      }),
    );
  }

  /** Remapea `orderingPayments.items[].accountId` (objeto, no array plano). */
  private remapOrderingPayments(raw: unknown, map: Map<string, string>): string {
    let obj: Record<string, unknown> = {};
    if (typeof raw === 'string' && raw.trim()) {
      try {
        obj = JSON.parse(raw);
      } catch {
        return typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
      }
    } else if (raw && typeof raw === 'object') {
      obj = { ...(raw as Record<string, unknown>) };
    } else {
      return JSON.stringify(raw ?? null);
    }
    if (Array.isArray(obj.items)) {
      obj.items = (obj.items as Array<Record<string, unknown>>).map((i) => {
        if (!i || typeof i !== 'object') return i;
        const accountId = i.accountId != null ? String(i.accountId) : '';
        if (!accountId) return i;
        return { ...i, accountId: map.get(accountId) ?? accountId };
      });
    }
    return JSON.stringify(obj);
  }

  /** Remapea UUIDs conocidos dentro de un JSON (snapshots, etc.). */
  private remapIdsInJsonTree(raw: unknown, map: Map<string, string>): string {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const walk = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          out[k] = walk(val);
        }
        return out;
      }
      if (typeof v === 'string' && uuidRe.test(v) && map.has(v)) return map.get(v)!;
      return v;
    };
    let root: unknown = raw;
    if (typeof raw === 'string' && raw.trim()) {
      try {
        root = JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return JSON.stringify(walk(root));
  }

  private remapPaymentsJson(raw: unknown, map: Map<string, string>): string {
    let items: Array<Record<string, unknown>> = [];
    if (typeof raw === 'string' && raw.trim()) {
      try {
        items = JSON.parse(raw);
      } catch {
        items = [];
      }
    } else if (Array.isArray(raw)) items = raw as Array<Record<string, unknown>>;
    return JSON.stringify(
      items.map((i) => {
        if (!i || typeof i !== 'object') return i;
        const out = { ...i };
        for (const key of ['accountId', 'paymentAccountId']) {
          if (out[key] != null && String(out[key]) !== '') {
            const id = String(out[key]);
            out[key] = map.get(id) ?? id;
          }
        }
        return out;
      }),
    );
  }

  private filterExistingUserIdsJson(raw: unknown, existing: Set<string>): string {
    let ids: string[] = [];
    if (typeof raw === 'string' && raw.trim()) {
      try {
        ids = JSON.parse(raw);
      } catch {
        ids = [];
      }
    } else if (Array.isArray(raw)) ids = raw.map(String);
    return JSON.stringify(ids.filter((id) => existing.has(id)));
  }

  /**
   * Tras importar: asegura filas en A Retirar según cierres (el Excel a veces
   * no trae cash_pending_withdrawals o fallan FKs de usuarios de prod).
   */
  private async rebuildCashPendingFromClosings(manager: any, shopId: string) {
    const closings = (await manager.query(
      `SELECT id, businessDate, cashWithdrawn, cashAmount, cashLeftInRegister,
              cashPendingPickup, cashWithdrawnByUserId, cashWithdrawnByEmployeeId,
              cashWithdrawnByName
       FROM cash_closings
       WHERE shopId = ? AND deletedAt IS NULL AND active = 1`,
      [shopId],
    )) as Array<{
      id: string;
      businessDate: string;
      cashWithdrawn: string | number;
      cashAmount: string | number;
      cashLeftInRegister: string | number;
      cashPendingPickup: string | number;
      cashWithdrawnByUserId: string | null;
      cashWithdrawnByEmployeeId: string | null;
      cashWithdrawnByName: string | null;
    }>;

    for (const c of closings) {
      const hasWho = !!(
        c.cashWithdrawnByUserId ||
        c.cashWithdrawnByEmployeeId ||
        String(c.cashWithdrawnByName ?? '').trim()
      );
      const withdrawn = Number(c.cashWithdrawn ?? 0);
      const computed =
        withdrawn > 0
          ? withdrawn
          : Math.max(0, Number(c.cashAmount ?? 0) - Number(c.cashLeftInRegister ?? 0));
      // Preferí el pendiente declarado en el cierre si viene en el dump.
      const declared = Number(c.cashPendingPickup ?? 0);
      const amount = declared > 0.009 ? declared : computed;

      const existing = (await manager.query(
        `SELECT id, status FROM cash_pending_withdrawals
         WHERE closingId = ? AND deletedAt IS NULL AND active = 1`,
        [c.id],
      )) as Array<{ id: string; status: string }>;
      const hasPicked = existing.some((r) => r.status === 'PICKED');
      const pending = existing.find((r) => r.status === 'PENDING');

      if (hasPicked || hasWho || amount <= 0.009) {
        if (pending) {
          await manager.query(
            `UPDATE cash_pending_withdrawals
             SET active = 0, deletedAt = NOW(6) WHERE id = ?`,
            [pending.id],
          );
        }
        await manager.query(
          `UPDATE cash_closings SET cashPendingPickup = '0.00' WHERE id = ? AND cashPendingPickup <> '0.00'`,
          [c.id],
        );
        continue;
      }

      const amt = amount.toFixed(2);
      if (pending) {
        await manager.query(
          `UPDATE cash_pending_withdrawals
           SET amount = ?, businessDate = ?, status = 'PENDING' WHERE id = ?`,
          [amt, c.businessDate, pending.id],
        );
      } else {
        await manager.query(
          `INSERT INTO cash_pending_withdrawals
           (id, createdAt, updatedAt, active, shopId, closingId, businessDate, amount, status)
           VALUES (?, NOW(6), NOW(6), 1, ?, ?, ?, ?, 'PENDING')`,
          [randomUUID(), shopId, c.id, c.businessDate, amt],
        );
      }
      await manager.query(`UPDATE cash_closings SET cashPendingPickup = ? WHERE id = ?`, [
        amt,
        c.id,
      ]);
    }
  }

  private remapJsonIds(raw: unknown, map: Map<string, string>): string {
    let ids: string[] = [];
    if (typeof raw === 'string' && raw.trim()) {
      try {
        ids = JSON.parse(raw);
      } catch {
        ids = [];
      }
    } else if (Array.isArray(raw)) ids = raw.map(String);
    return JSON.stringify(ids.map((id) => map.get(id) ?? id));
  }

  private remapChannelLeaves(raw: unknown, map: Map<string, string>): string {
    let items: Array<{ accountId?: string }> = [];
    if (typeof raw === 'string' && raw.trim()) {
      try {
        items = JSON.parse(raw);
      } catch {
        items = [];
      }
    } else if (Array.isArray(raw)) items = raw as Array<{ accountId?: string }>;
    return JSON.stringify(
      items.map((i) => ({
        ...i,
        accountId: i.accountId ? map.get(i.accountId) ?? i.accountId : i.accountId,
      })),
    );
  }

  private sqlValue(v: unknown): unknown {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return this.toMysqlDateTime(v);
    if (typeof v === 'string') {
      const asDt = this.coerceMysqlDateTime(v);
      if (asDt != null) return asDt;
    }
    return v;
  }

  /**
   * Convierte ISO (`2026-09-22T15:23:04.786Z`) u otros strings de fecha a
   * `YYYY-MM-DD HH:MM:SS.ffffff` (MySQL DATETIME). Si no parece datetime, null.
   */
  private coerceMysqlDateTime(raw: string): string | null {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(s)) {
      return s.includes('.') ? s.padEnd(26, '0').slice(0, 26) : s;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // ISO 8601 / Excel-ish con T o zona
    if (!/^\d{4}-\d{2}-\d{2}T/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
      return null;
    }
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return this.toMysqlDateTime(d);
  }

  private toMysqlDateTime(d: Date): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return (
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
      `${pad(d.getUTCMilliseconds(), 3)}000`
    );
  }
}
