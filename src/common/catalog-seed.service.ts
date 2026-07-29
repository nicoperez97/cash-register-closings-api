import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LedgerAccount } from '../entities/ledger-account.entity';
import { Concept } from '../entities/concept.entity';
import { DEFAULT_CONCEPTS, DEFAULT_LEDGER_ACCOUNTS } from './catalog-seed';

@Injectable()
export class CatalogSeedService {
  constructor(
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(Concept) private readonly concepts: Repository<Concept>,
  ) {}

  async ensureShopCatalogs(shopId: string) {
    for (const a of DEFAULT_LEDGER_ACCOUNTS) {
      const exists = await this.accounts.findOne({
        where: { shopId, code: a.code },
        withDeleted: true,
      });
      if (exists) continue;
      await this.accounts.save(
        this.accounts.create({
          shopId,
          name: a.name,
          code: a.code,
          type: a.type,
          linkedPaymentMethod: a.linkedPaymentMethod ?? null,
          active: true,
        }),
      );
    }

    for (const c of DEFAULT_CONCEPTS) {
      const exists = await this.concepts.findOne({
        where: { shopId, name: c.name },
        withDeleted: true,
      });
      if (exists) continue;
      await this.concepts.save(
        this.concepts.create({
          shopId,
          name: c.name,
          kind: c.kind,
          active: true,
        }),
      );
    }
  }
}
