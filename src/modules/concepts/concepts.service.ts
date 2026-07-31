import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Concept } from '../../entities/concept.entity';
import { AuthUser } from '../../common/decorators';
import { ConceptKind } from '../../common/enums';
import { ShopsService } from '../shops/shops.service';
import { CatalogSeedService } from '../../common/catalog-seed.service';
import { markDeletedUnique } from '../../common/soft-delete.util';

@Injectable()
export class ConceptsService {
  constructor(
    @InjectRepository(Concept) private readonly concepts: Repository<Concept>,
    private readonly shops: ShopsService,
    private readonly catalogSeed: CatalogSeedService,
  ) {}

  private toDto(c: Concept) {
    return {
      id: c.id,
      shopId: c.shopId,
      name: c.name,
      kind: c.kind,
      active: !!c.active,
    };
  }

  async list(user: AuthUser, shopId: string, kind?: ConceptKind) {
    this.shops.assertShopAccess(user, shopId);
    const where: { shopId: string; active: boolean; kind?: ConceptKind } = {
      shopId,
      active: true,
    };
    if (kind) where.kind = kind;
    const rows = await this.concepts.find({
      where,
      order: { kind: 'ASC', name: 'ASC' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    user: AuthUser,
    shopId: string,
    dto: { name: string; kind?: ConceptKind; active?: boolean },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const name = dto.name.trim();
    const clash = await this.concepts.findOne({ where: { shopId, name } });
    if (clash) throw new BadRequestException('Ya existe un concepto con ese nombre');
    const row = await this.concepts.save(
      this.concepts.create({
        shopId,
        name,
        kind: dto.kind ?? ConceptKind.EXPENSE,
        active: dto.active ?? true,
      }),
    );
    return this.toDto(row);
  }

  async update(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: { name?: string; kind?: ConceptKind; active?: boolean },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.concepts.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Concepto no encontrado');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const clash = await this.concepts.findOne({ where: { shopId, name } });
      if (clash && clash.id !== id) {
        throw new BadRequestException('Ya existe un concepto con ese nombre');
      }
      row.name = name;
    }
    if (dto.kind !== undefined) row.kind = dto.kind;
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
}
