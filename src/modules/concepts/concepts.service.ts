import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Concept } from '../../entities/concept.entity';
import { AuthUser } from '../../common/decorators';
import { ConceptKind } from '../../common/enums';
import { ShopsService } from '../shops/shops.service';
import { CatalogSeedService } from '../../common/catalog-seed.service';
import { displaySoftDeletedLabel, looksSoftDeletedLabel, markDeletedUnique } from '../../common/soft-delete.util';
import {
  inferConceptCategories,
  isPaymentConceptScope,
  normalizeConceptCategories,
  normalizePaymentConceptCategories,
  conceptMatchesCategories,
  withClosureForSuppliers,
  type PaymentConceptScope,
} from '../../common/concept-categories';

@Injectable()
export class ConceptsService implements OnModuleInit {
  constructor(
    @InjectRepository(Concept) private readonly concepts: Repository<Concept>,
    private readonly shops: ShopsService,
    private readonly catalogSeed: CatalogSeedService,
  ) {}

  async onModuleInit() {
    for (const sql of [
      `ALTER TABLE concepts ADD COLUMN description TEXT NULL`,
      `ALTER TABLE concepts ADD COLUMN validated TINYINT(1) NOT NULL DEFAULT 1`,
      `ALTER TABLE concepts ADD COLUMN categories JSON NULL`,
    ]) {
      try {
        await this.concepts.query(sql);
      } catch {
        // ya aplicado
      }
    }
    await this.backfillCategories();
    await this.repairActiveDeletedLabels();
  }

  /** Conceptos vivos que quedaron con sufijo __DELETED__ (p.ej. tras recover). */
  private async repairActiveDeletedLabels() {
    const rows = await this.concepts.find({ where: { active: true } });
    for (const row of rows) {
      if (!looksSoftDeletedLabel(row.name)) continue;
      row.name = await this.uniqueCleanName(row.shopId, row.name, row.id);
      await this.concepts.save(row);
    }
  }

  private async uniqueCleanName(shopId: string, rawName: string, selfId: string): Promise<string> {
    const base = displaySoftDeletedLabel(rawName)?.trim() || 'Concepto';
    let candidate = base;
    for (let n = 2; n <= 50; n++) {
      const other = await this.concepts.findOne({ where: { shopId, name: candidate } });
      if (!other || other.id === selfId) return candidate;
      candidate = `${base} (${n})`;
    }
    return `${base} · ${selfId.slice(0, 8)}`;
  }

  private async backfillCategories() {
    const rows = await this.concepts.find();
    for (const row of rows) {
      let cats =
        Array.isArray(row.categories) && row.categories.length
          ? normalizeConceptCategories(row.categories)
          : inferConceptCategories(row.name);
      cats = withClosureForSuppliers(cats);
      const prev = JSON.stringify(
        Array.isArray(row.categories) ? [...row.categories].sort() : [],
      );
      const next = JSON.stringify([...cats].sort());
      if (prev === next) continue;
      row.categories = cats;
      await this.concepts.save(row);
    }
  }

  toDto(c: Concept) {
    const rawName = c.name ?? '';
    const cleaned = displaySoftDeletedLabel(rawName);
    return {
      id: c.id,
      shopId: c.shopId,
      name: cleaned || (looksSoftDeletedLabel(rawName) ? 'Concepto eliminado' : rawName),
      description: c.description ?? null,
      kind: c.kind,
      categories: withClosureForSuppliers(normalizeConceptCategories(c.categories)),
      validated: !!c.validated,
      active: !!c.active,
    };
  }

  async list(
    user: AuthUser,
    shopId: string,
    opts?: {
      kind?: ConceptKind;
      includeInactive?: boolean;
      includeUnvalidated?: boolean;
      for?: PaymentConceptScope;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const qb = this.concepts
      .createQueryBuilder('c')
      .where('c.shopId = :shopId', { shopId })
      .andWhere('c.deletedAt IS NULL');
    if (!opts?.includeInactive) qb.andWhere('c.active = 1');
    if (!opts?.includeUnvalidated) qb.andWhere('c.validated = 1');
    if (opts?.kind) qb.andWhere('c.kind = :kind', { kind: opts.kind });
    const rows = await qb.orderBy('c.kind', 'ASC').addOrderBy('c.name', 'ASC').getMany();
    let wanted: ReturnType<typeof normalizePaymentConceptCategories>['supplier'] | null = null;
    if (opts?.for && isPaymentConceptScope(opts.for)) {
      const shop = await this.shops.getShopEntity(shopId);
      wanted = normalizePaymentConceptCategories(shop?.paymentConceptCategories)[opts.for];
    }
    return rows
      .filter((r) => !wanted || conceptMatchesCategories(r.categories, wanted))
      .map((r) => this.toDto(r));
  }

  async create(
    user: AuthUser,
    shopId: string,
    dto: {
      name: string;
      description?: string | null;
      kind?: ConceptKind;
      categories?: string[] | null;
      validated?: boolean;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Ingresá un nombre');
    const clash = await this.concepts.findOne({ where: { shopId, name } });
    if (clash) throw new BadRequestException('Ya existe un concepto con ese nombre');
    const row = await this.concepts.save(
      this.concepts.create({
        shopId,
        name,
        description: this.emptyToNull(dto.description),
        kind: dto.kind ?? ConceptKind.EXPENSE,
        categories: withClosureForSuppliers(
          dto.categories !== undefined
            ? normalizeConceptCategories(dto.categories)
            : inferConceptCategories(name),
        ),
        validated: dto.validated ?? true,
        active: dto.active ?? true,
      }),
    );
    return this.toDto(row);
  }

  async update(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: {
      name?: string;
      description?: string | null;
      kind?: ConceptKind;
      categories?: string[] | null;
      validated?: boolean;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.concepts.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Concepto no encontrado');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Ingresá un nombre');
      const clash = await this.concepts.findOne({ where: { shopId, name } });
      if (clash && clash.id !== id) {
        throw new BadRequestException('Ya existe un concepto con ese nombre');
      }
      row.name = name;
    }
    if (dto.description !== undefined) row.description = this.emptyToNull(dto.description);
    if (dto.kind !== undefined) row.kind = dto.kind;
    if (dto.categories !== undefined) {
      row.categories = withClosureForSuppliers(normalizeConceptCategories(dto.categories));
    }
    if (dto.validated !== undefined) row.validated = dto.validated;
    if (dto.active !== undefined) row.active = dto.active;
    await this.concepts.save(row);
    return this.toDto(row);
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.concepts.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Concepto no encontrado');
    row.name = markDeletedUnique(row.name, row.id);
    row.active = false;
    await this.concepts.save(row);
    await this.concepts.softRemove(row);
    return { ok: true };
  }

  /**
   * Une varios conceptos en uno (nuevo o existente).
   * Reasigna pagos, movimientos y egresos de cierre; archiva los de origen.
   */
  async unify(
    user: AuthUser,
    shopId: string,
    dto: {
      sourceIds: string[];
      targetId?: string | null;
      targetName?: string | null;
      kind?: ConceptKind;
      categories?: string[] | null;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const sourceIds = [...new Set((dto.sourceIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (sourceIds.length < 1) {
      throw new BadRequestException('Seleccioná al menos un concepto para unificar');
    }

    const sources = await this.concepts.find({
      where: { id: In(sourceIds), shopId },
    });
    if (sources.length !== sourceIds.length) {
      throw new NotFoundException('Algún concepto no existe en este local');
    }

    let target: Concept | null = null;
    const targetId = (dto.targetId || '').trim() || null;
    if (targetId) {
      target = await this.concepts.findOne({
        where: { id: targetId, shopId },
        withDeleted: true,
      });
      if (!target) {
        throw new NotFoundException('Concepto destino no encontrado');
      }
      if (sourceIds.includes(target.id) && sourceIds.length === 1) {
        throw new BadRequestException('Elegí al menos otro concepto además del destino');
      }
    } else {
      const name = String(dto.targetName || '').trim();
      if (!name) {
        throw new BadRequestException('Ingresá el nombre del concepto unificado');
      }
      const clash = await this.concepts.findOne({ where: { shopId, name } });
      if (clash && !sourceIds.includes(clash.id)) {
        throw new BadRequestException('Ya existe un concepto con ese nombre');
      }
      if (clash && sourceIds.includes(clash.id)) {
        target = clash;
      } else {
        const kind = dto.kind ?? sources[0]?.kind ?? ConceptKind.EXPENSE;
        const categories = withClosureForSuppliers(
          dto.categories !== undefined
            ? normalizeConceptCategories(dto.categories)
            : normalizeConceptCategories(sources[0]?.categories) || inferConceptCategories(name),
        );
        target = await this.concepts.save(
          this.concepts.create({
            shopId,
            name,
            description: null,
            kind,
            categories,
            validated: true,
            active: true,
          }),
        );
      }
    }

    // Asegurar que el destino quede usable (por si estaba inactivo o archivado).
    if (target.deletedAt) {
      await this.concepts.recover(target);
      target = (await this.concepts.findOne({
        where: { id: target.id, shopId },
        withDeleted: true,
      }))!;
    }
    if (looksSoftDeletedLabel(target.name)) {
      target.name = await this.uniqueCleanName(shopId, target.name, target.id);
    }
    target.active = true;
    target.validated = true;
    target = await this.concepts.save(target);

    const fromIds = sourceIds.filter((id) => id !== target!.id);
    if (!fromIds.length) {
      return {
        ok: true,
        target: this.toDto(target!),
        reassigned: { payments: 0, movements: 0, closingExpenses: 0 },
        removed: 0,
      };
    }

    const payBefore = await this.concepts.query(
      `SELECT COUNT(*) AS c FROM payments WHERE shopId = ? AND conceptId IN (${fromIds.map(() => '?').join(',')})`,
      [shopId, ...fromIds],
    );
    const movBefore = await this.concepts.query(
      `SELECT COUNT(*) AS c FROM movements WHERE shopId = ? AND conceptId IN (${fromIds.map(() => '?').join(',')})`,
      [shopId, ...fromIds],
    );
    const ceBefore = await this.concepts.query(
      `SELECT COUNT(*) AS c FROM closing_expenses ce
       INNER JOIN cash_closings cc ON cc.id = ce.closingId
       WHERE cc.shopId = ? AND ce.conceptId IN (${fromIds.map(() => '?').join(',')})`,
      [shopId, ...fromIds],
    );

    await this.concepts.query(
      `UPDATE payments SET conceptId = ? WHERE shopId = ? AND conceptId IN (${fromIds.map(() => '?').join(',')})`,
      [target!.id, shopId, ...fromIds],
    );
    await this.concepts.query(
      `UPDATE movements SET conceptId = ? WHERE shopId = ? AND conceptId IN (${fromIds.map(() => '?').join(',')})`,
      [target!.id, shopId, ...fromIds],
    );
    await this.concepts.query(
      `UPDATE closing_expenses ce
       INNER JOIN cash_closings cc ON cc.id = ce.closingId
       SET ce.conceptId = ?
       WHERE cc.shopId = ? AND ce.conceptId IN (${fromIds.map(() => '?').join(',')})`,
      [target!.id, shopId, ...fromIds],
    );
    // Retiros de caja del local: si apuntaban a un origen, pasar al destino.
    await this.concepts.query(
      `UPDATE shops SET cashWithdrawalConceptId = ? WHERE id = ? AND cashWithdrawalConceptId IN (${fromIds.map(() => '?').join(',')})`,
      [target!.id, shopId, ...fromIds],
    );
    await this.concepts.query(
      `UPDATE shops SET partnerDividendConceptId = ? WHERE id = ? AND partnerDividendConceptId IN (${fromIds.map(() => '?').join(',')})`,
      [target!.id, shopId, ...fromIds],
    );
    // Reparar egresos de cierre cuyo movimiento quedó sin concepto (sync viejo).
    await this.repairClosingExpenseMovementLinks(shopId);

    let removed = 0;
    for (const row of sources) {
      if (row.id === target!.id) continue;
      row.name = markDeletedUnique(row.name, row.id);
      row.active = false;
      await this.concepts.save(row);
      await this.concepts.softRemove(row);
      removed += 1;
    }

    const countOf = (rows: Array<{ c?: number | string }>) => Number(rows?.[0]?.c ?? 0) || 0;

    return {
      ok: true,
      target: this.toDto(target!),
      reassigned: {
        payments: countOf(payBefore),
        movements: countOf(movBefore),
        closingExpenses: countOf(ceBefore),
      },
      removed,
    };
  }

  /**
   * Realinea movimientos de cierre con el conceptId del egreso del cierre.
   * Corrige syncs viejos que ignoraban exp.conceptId (p.ej. tras unificar).
   */
  async repairClosingExpenseMovementLinks(shopId: string): Promise<number> {
    const result = await this.concepts.query(
      `UPDATE movements m
       INNER JOIN closing_expenses ce ON ce.closingId = m.closingId
         AND TRIM(IFNULL(ce.label, '')) = TRIM(IFNULL(m.description, ''))
         AND ROUND(ce.amount, 2) = ROUND(m.amountUyu, 2)
       INNER JOIN cash_closings cc ON cc.id = m.closingId AND cc.shopId = ?
       INNER JOIN concepts c ON c.id = ce.conceptId
         AND c.deletedAt IS NULL
         AND IFNULL(c.active, 1) <> 0
         AND LOCATE('__DELETED__', IFNULL(c.name, '')) = 0
       SET m.conceptId = ce.conceptId
       WHERE ce.conceptId IS NOT NULL
         AND m.active = 1
         AND (m.conceptId IS NULL OR m.conceptId <> ce.conceptId)`,
      [shopId],
    );
    return Number(result?.affectedRows ?? result?.changedRows ?? 0) || 0;
  }

  async findByShop(shopId: string) {
    return this.concepts.find({ where: { shopId } });
  }

  emptyToNull(v?: string | null) {
    const s = (v ?? '').trim();
    return s ? s : null;
  }
}
