import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { Movement } from '../../entities/movement.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Concept } from '../../entities/concept.entity';
import { Employee } from '../../entities/employee.entity';
import { LinkedPaymentMethod } from '../../common/enums';
import { EXPENSE_CATEGORY_TO_CONCEPT } from '../../common/catalog-seed';
import { CatalogSeedService } from '../../common/catalog-seed.service';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);

@Injectable()
export class ClosingMovementsSyncService {
  constructor(
    @InjectRepository(Movement) private readonly movements: Repository<Movement>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(Concept) private readonly concepts: Repository<Concept>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    private readonly catalogSeed: CatalogSeedService,
  ) {}

  async syncFromClosing(closing: CashClosing) {
    await this.movements.delete({ closingId: closing.id });

    const accounts = await this.accounts.find({
      where: { shopId: closing.shopId, active: true },
    });
    if (!accounts.length) return;
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const byMethod = new Map(
      accounts
        .filter((a) => a.linkedPaymentMethod)
        .map((a) => [a.linkedPaymentMethod as string, a]),
    );
    const ingreso = byCode.get('INGRESO');
    const egreso = byCode.get('EGRESO');
    if (!ingreso || !egreso) return;

    const concepts = await this.concepts.find({
      where: { shopId: closing.shopId, active: true },
    });
    const conceptByName = new Map(concepts.map((c) => [c.name, c]));

    const findConcept = (name: string) => conceptByName.get(name)?.id ?? null;

    const rows: Partial<Movement>[] = [];
    const date = closing.businessDate;

    const pushIncome = (
      method: LinkedPaymentMethod,
      amount: number,
      label: string,
      conceptName: string,
    ) => {
      if (amount <= 0) return;
      const channel = byMethod.get(method) ?? byCode.get('EFECTIVO') ?? egreso;
      rows.push({
        shopId: closing.shopId,
        businessDate: date,
        fromAccountId: ingreso.id,
        toAccountId: channel.id,
        description: label,
        amountUyu: money(amount),
        conceptId: findConcept(conceptName),
        closingId: closing.id,
        invoiced: false,
        active: true,
      });
    };

    pushIncome(
      LinkedPaymentMethod.CASH,
      n(closing.cashAmount),
      'Efectivo del día',
      'EFECTIVO ingreso',
    );
    pushIncome(
      LinkedPaymentMethod.CARD,
      n(closing.cardAmount),
      'PVS / Tarjeta',
      'Cobro',
    );
    pushIncome(
      LinkedPaymentMethod.MERCADO_PAGO,
      n(closing.mercadoPagoAmount),
      'Mercado Pago',
      'Cobro',
    );
    pushIncome(
      LinkedPaymentMethod.DELIVERY,
      n(closing.deliveryAppsAmount),
      'Delivery',
      'Cobro',
    );
    pushIncome(
      LinkedPaymentMethod.TRANSFER,
      n(closing.transferAmount),
      'Transferencia',
      'Cobro',
    );
    pushIncome(
      LinkedPaymentMethod.ACCOUNT_DNI,
      n(closing.accountDniAmount),
      'Cuenta DNI',
      'Cobro',
    );
    if (n(closing.otherAmount) > 0) {
      pushIncome(LinkedPaymentMethod.OTHER, n(closing.otherAmount), 'Otros ingresos', 'Ingreso');
    }

    const cashChannel =
      byMethod.get(LinkedPaymentMethod.CASH) ?? byCode.get('EFECTIVO');
    if (cashChannel && n(closing.cashWithdrawn) > 0) {
      let toAccountId = egreso.id;
      let employeeId: string | null = closing.cashWithdrawnByEmployeeId ?? null;

      if (closing.cashWithdrawnByEmployeeId) {
        const emp = await this.employees.findOne({
          where: { id: closing.cashWithdrawnByEmployeeId, shopId: closing.shopId },
        });
        if (emp) {
          // retiro va a egreso genérico; se marca empleado
          employeeId = emp.id;
        }
      } else if (closing.cashWithdrawnByName) {
        const partner = accounts.find(
          (a) =>
            a.type === 'PARTNER' &&
            a.name.toLowerCase() === closing.cashWithdrawnByName!.trim().toLowerCase(),
        );
        if (partner) toAccountId = partner.id;
      }

      rows.push({
        shopId: closing.shopId,
        businessDate: date,
        fromAccountId: cashChannel.id,
        toAccountId,
        description: `Retiro de efectivo${
          closing.cashWithdrawnByName ? ` — ${closing.cashWithdrawnByName}` : ''
        }`,
        amountUyu: money(n(closing.cashWithdrawn)),
        conceptId: findConcept('Utilidades') ?? findConcept('Gastos varios'),
        closingId: closing.id,
        employeeId,
        invoiced: false,
        active: true,
      });
    }

    for (const exp of closing.expenses ?? []) {
      const amount = n(exp.amount);
      if (amount <= 0) continue;
      const conceptName =
        EXPENSE_CATEGORY_TO_CONCEPT[exp.category] ?? 'Otros gastos';
      const fromAccount = cashChannel ?? byCode.get('TOMA') ?? egreso;
      rows.push({
        shopId: closing.shopId,
        businessDate: date,
        fromAccountId: fromAccount.id,
        toAccountId: egreso.id,
        description: exp.label,
        amountUyu: money(amount),
        conceptId: findConcept(conceptName),
        closingId: closing.id,
        invoiced: false,
        active: true,
      });
    }

    if (rows.length) {
      await this.movements.save(rows.map((r) => this.movements.create(r)));
    }
  }
}
