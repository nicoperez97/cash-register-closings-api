import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Concept } from '../../entities/concept.entity';
import { AuthUser } from '../../common/decorators';
import { ConceptKind } from '../../common/enums';
import { ShopsService } from '../shops/shops.service';
import { CatalogSeedService } from '../../common/catalog-seed.service';
import { markDeletedUnique } from '../../common/soft-delete.util';
import {
  inferConceptCategories,
  isPaymentConceptScope,
  normalizeConceptCategories,
  normalizePaymentConceptCategories,
  conceptMatchesCategories,
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
  }

  private async backfillCategories() {
    const rows = await this.concepts.find();
    const pending = rows.filter((r) => !Array.isArray(r.categories) || !r.categories.length);
    for (const row of pending) {
      row.categories = inferConceptCategories(row.name);
      await this.concepts.save(row);
    }
  }

  toDto(c: Concept) {
    return {
      id: c.id,
      shopId: c.shopId,
      name: c.name,
      description: c.description ?? null,
      kind: c.kind,
      categories: normalizeConceptCategories(c.categories),
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
        categories:
          dto.categories !== undefined
            ? normalizeConceptCategories(dto.categories)
            : inferConceptCategories(name),
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
      row.categories = normalizeConceptCategories(dto.categories);
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

  async findByShop(shopId: string) {
    return this.concepts.find({ where: { shopId } });
  }

  emptyToNull(v?: string | null) {
    const s = (v ?? '').trim();
    return s ? s : null;
  }
}
