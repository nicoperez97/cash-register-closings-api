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
import { ConceptKind, LedgerAccountType } from './enums';
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
          hideFromCashWithdraw: false,
          listInExpenses: true,
          listInIncomes: true,
          listInTransfers: true,
          listInBalances: true,
          active: true,
        }),
      );
    }
    await this.ensureConcepts(shopId);
  }

  /** Cuenta Egreso del local (destino default de división de socios). */
  async ensureEgresoAccount(shopId: string): Promise<LedgerAccount> {
    await this.ensureShopCatalogs(shopId);
    const byCode = await this.accounts.findOne({
      where: { shopId, code: 'EGRESO', active: true },
    });
    if (byCode) return byCode;
    const byName = await this.accounts
      .createQueryBuilder('a')
      .where('a.shopId = :shopId', { shopId })
      .andWhere('a.active = true')
      .andWhere('a.type = :type', { type: LedgerAccountType.SYSTEM })
      .andWhere('LOWER(a.name) LIKE :name', { name: '%egreso%' })
      .getOne();
    if (byName) return byName;
    throw new Error(`No se pudo asegurar la cuenta Egreso del local ${shopId}`);
  }

  /**
   * @deprecated La división usa Egreso + concepto. Se mantiene por compatibilidad
   * de imports: resuelve a Egreso.
   */
  async ensureDividendsAccount(shopId: string): Promise<LedgerAccount> {
    return this.ensureEgresoAccount(shopId);
  }

  /** Concepto "División" (egreso) para movimientos de división de socios. */
  async ensureDivisionConcept(shopId: string): Promise<Concept> {
    await this.ensureConcepts(shopId);
    const existing = await this.concepts.findOne({
      where: { shopId, name: 'División', active: true },
    });
    if (existing) return existing;
    const alt = await this.concepts
      .createQueryBuilder('c')
      .where('c.shopId = :shopId', { shopId })
      .andWhere('c.active = true')
      .andWhere('LOWER(c.name) IN (:...names)', {
        names: ['división', 'division', 'división de socios', 'division de socios'],
      })
      .getOne();
    if (alt) return alt;
    return this.concepts.save(
      this.concepts.create({
        shopId,
        name: 'División',
        kind: ConceptKind.EXPENSE,
        categories: inferConceptCategories('División'),
        active: true,
        validated: true,
      }),
    );
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
          hideFromCashWithdraw: false,
          listInExpenses: true,
          listInIncomes: true,
          listInTransfers: true,
          listInBalances: true,
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
