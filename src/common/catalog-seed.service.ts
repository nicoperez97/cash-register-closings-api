import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LedgerAccount } from '../entities/ledger-account.entity';
import { Concept } from '../entities/concept.entity';
import {
  DEFAULT_CONCEPTS,
  DEFAULT_LEDGER_ACCOUNTS,
  SYSTEM_LEDGER_ACCOUNTS,
} from './catalog-seed';
import { LedgerAccountType } from './enums';
import { inferConceptCategories } from './concept-categories';

@Injectable()
export class CatalogSeedService {
  constructor(
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(Concept) private readonly concepts: Repository<Concept>,
  ) {}

  /**
   * Solo INGRESO/EGRESO + conceptos faltantes.
   * No recrea canales ni socios: los depósitos del cierre definen los canales.
   */
  async ensureShopCatalogs(shopId: string) {
    for (const a of SYSTEM_LEDGER_ACCOUNTS) {
      if (await this.accountExistsOrWasDeleted(shopId, a.code)) continue;
      await this.accounts.save(
        this.accounts.create({
          shopId,
          name: a.name,
          code: a.code,
          type: a.type,
          linkedPaymentMethod: null,
          hideFromCashWithdraw: a.type === LedgerAccountType.DIVIDENDS,
          listInExpenses: a.type !== LedgerAccountType.DIVIDENDS,
          listInIncomes: a.type !== LedgerAccountType.DIVIDENDS,
          listInTransfers: true,
          // Dividendos: plata personal del socio, ya no disponible para el local → fuera de Saldos.
          listInBalances: a.type !== LedgerAccountType.DIVIDENDS,
          active: true,
        }),
      );
    }
    await this.ensureConcepts(shopId);
  }

  /** Cuenta Dividendos del local (una sola). La crea si falta. */
  async ensureDividendsAccount(shopId: string): Promise<LedgerAccount> {
    await this.ensureShopCatalogs(shopId);
    const byCode = await this.accounts.findOne({
      where: { shopId, code: 'DIVIDENDOS', active: true },
    });
    const row =
      byCode ??
      (await this.accounts.findOne({
        where: { shopId, type: LedgerAccountType.DIVIDENDS, active: true },
      }));
    if (!row) {
      throw new Error(`No se pudo asegurar la cuenta Dividendos del local ${shopId}`);
    }
    // Fuera de Saldos: esa plata ya no es del local.
    if (Number(row.listInBalances ?? 1) !== 0) {
      row.listInBalances = false;
      row.hideFromCashWithdraw = true;
      row.listInExpenses = false;
      row.listInIncomes = false;
      await this.accounts.save(row);
    }
    return row;
  }

  /** Catálogo completo al crear un local (sin vincular medios de pago). */
  async seedNewShopCatalogs(shopId: string) {
    for (const a of DEFAULT_LEDGER_ACCOUNTS) {
      if (await this.accountExistsOrWasDeleted(shopId, a.code)) continue;
      await this.accounts.save(
        this.accounts.create({
          shopId,
          name: a.name,
          code: a.code,
          type: a.type,
          linkedPaymentMethod: null,
          hideFromCashWithdraw: a.type === LedgerAccountType.DIVIDENDS,
          listInExpenses: a.type !== LedgerAccountType.DIVIDENDS,
          listInIncomes: a.type !== LedgerAccountType.DIVIDENDS,
          listInTransfers: true,
          // Dividendos: plata personal del socio, ya no disponible para el local → fuera de Saldos.
          listInBalances: a.type !== LedgerAccountType.DIVIDENDS,
          active: true,
        }),
      );
    }
    await this.ensureConcepts(shopId);
  }

  private async ensureConcepts(shopId: string) {
    for (const c of DEFAULT_CONCEPTS) {
      if (await this.conceptExistsOrWasDeleted(shopId, c.name)) continue;
      await this.concepts.save(
        this.concepts.create({
          shopId,
          name: c.name,
          kind: c.kind,
          categories: inferConceptCategories(c.name),
          active: true,
          validated: true,
        }),
      );
    }
  }

  /**
   * El soft-delete renombra code/name a `valor__DELETED__{8hex}`.
   * Sin esto, el seed recreaba cuentas/conceptos que el usuario ya había borrado.
   */
  private async accountExistsOrWasDeleted(shopId: string, code: string): Promise<boolean> {
    const exact = await this.accounts.findOne({
      where: { shopId, code },
      withDeleted: true,
    });
    if (exact) return true;

    const deleted = await this.accounts
      .createQueryBuilder('a')
      .withDeleted()
      .where('a.shopId = :shopId', { shopId })
      .andWhere('a.code LIKE :pattern', { pattern: `${code}__DELETED__%` })
      .getOne();
    return !!deleted;
  }

  private async conceptExistsOrWasDeleted(shopId: string, name: string): Promise<boolean> {
    const exact = await this.concepts.findOne({
      where: { shopId, name },
      withDeleted: true,
    });
    if (exact) return true;

    const deleted = await this.concepts
      .createQueryBuilder('c')
      .withDeleted()
      .where('c.shopId = :shopId', { shopId })
      .andWhere('c.name LIKE :pattern', { pattern: `${name}__DELETED__%` })
      .getOne();
    return !!deleted;
  }
}
