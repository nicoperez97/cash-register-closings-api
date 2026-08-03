import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { Movement } from '../../entities/movement.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Concept } from '../../entities/concept.entity';
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
    private readonly catalogSeed: CatalogSeedService,
  ) {}

  async syncFromClosing(closing: CashClosing) {
    await this.movements.delete({ closingId: closing.id });

    await this.catalogSeed.ensureShopCatalogs(closing.shopId);

    // Incluye inactivas: hace falta INGRESO/EGRESO/EFECTIVO aunque las hayan ocultado.
    const accounts = await this.accounts.find({ where: { shopId: closing.shopId } });
    if (!accounts.length) return;
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const byMethod = new Map(
      accounts
        .filter((a) => a.linkedPaymentMethod && a.active)
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

    // Efectivo a la cuenta de quien se lo lleva (PARTNER).
    // Si no hay monto de retiro explícito, se usa efectivo − cambio − egresos.
    let partnerDestId: string | null = null;
    if (closing.cashWithdrawnToAccountId) {
      const dest = accounts.find((a) => a.id === closing.cashWithdrawnToAccountId);
      if (dest) partnerDestId = dest.id;
    } else if (closing.cashWithdrawnByName) {
      const partner = accounts.find(
        (a) =>
          a.active &&
          a.type === 'PARTNER' &&
          a.name.toLowerCase() === closing.cashWithdrawnByName!.trim().toLowerCase(),
      );
      if (partner) partnerDestId = partner.id;
    }

    const expensesTotal = (closing.expenses ?? []).reduce((s, e) => s + n(e.amount), 0);
    const cashTake =
      n(closing.cashWithdrawn) > 0
        ? n(closing.cashWithdrawn)
        : Math.max(0, n(closing.cashAmount) - n(closing.cashLeftInRegister) - expensesTotal);

    if (cashChannel && partnerDestId && cashTake > 0) {
      rows.push({
        shopId: closing.shopId,
        businessDate: date,
        fromAccountId: cashChannel.id,
        toAccountId: partnerDestId,
        description: `Efectivo — ${closing.cashWithdrawnByName ?? 'retiro'}`,
        amountUyu: money(cashTake),
        conceptId: findConcept('Utilidades') ?? findConcept('Gastos varios'),
        closingId: closing.id,
        employeeId: closing.cashWithdrawnByEmployeeId ?? null,
        invoiced: false,
        active: true,
      });
    } else if (cashChannel && n(closing.cashWithdrawn) > 0) {
      rows.push({
        shopId: closing.shopId,
        businessDate: date,
        fromAccountId: cashChannel.id,
        toAccountId: egreso.id,
        description: `Retiro de efectivo${
          closing.cashWithdrawnByName ? ` — ${closing.cashWithdrawnByName}` : ''
        }`,
        amountUyu: money(n(closing.cashWithdrawn)),
        conceptId: findConcept('Utilidades') ?? findConcept('Gastos varios'),
        closingId: closing.id,
        employeeId: closing.cashWithdrawnByEmployeeId ?? null,
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
