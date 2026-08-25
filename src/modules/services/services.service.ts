import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShopService } from '../../entities/shop-service.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { AuthUser } from '../../common/decorators';
import { LedgerAccountType } from '../../common/enums';
import { isEntityActive } from '../../common/active.util';
import { ShopsService } from '../shops/shops.service';

const LEDGER_TYPE_ENUM =
  "ENUM('PARTNER', 'CHANNEL', 'SYSTEM', 'SUPPLIER', 'SERVICE')";

@Injectable()
export class ServicesService implements OnModuleInit {
  constructor(
    @InjectRepository(ShopService) private readonly services: Repository<ShopService>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    private readonly shops: ShopsService,
  ) {}

  async onModuleInit() {
    try {
      await this.services.query(`
        ALTER TABLE ledger_accounts
          MODIFY COLUMN type ${LEDGER_TYPE_ENUM}
          NOT NULL DEFAULT 'PARTNER'
      `);
    } catch {
      // enum ya actualizado o motor distinto
    }
    try {
      await this.services.query(`
        CREATE TABLE IF NOT EXISTS services (
          id CHAR(36) NOT NULL PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          name VARCHAR(200) NOT NULL,
          legalName VARCHAR(200) NULL,
          taxId VARCHAR(20) NULL,
          bankAlias VARCHAR(100) NULL,
          notes VARCHAR(500) NULL,
          accountId CHAR(36) NOT NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX idx_services_shop (shopId),
          INDEX idx_services_account (accountId)
        )
      `);
    } catch {
      // ya existe
    }
    for (const sql of [
      `ALTER TABLE services ADD COLUMN legalName VARCHAR(200) NULL`,
      `ALTER TABLE services ADD COLUMN taxId VARCHAR(20) NULL`,
      `ALTER TABLE services ADD COLUMN bankAlias VARCHAR(100) NULL`,
    ]) {
      try {
        await this.services.query(sql);
      } catch {
        // ya aplicado
      }
    }
  }

  private toDto(s: ShopService) {
    return {
      id: s.id,
      shopId: s.shopId,
      name: s.name,
      legalName: s.legalName ?? null,
      taxId: s.taxId ?? null,
      bankAlias: s.bankAlias ?? null,
      notes: s.notes ?? null,
      accountId: s.accountId,
      accountName: s.account?.name ?? null,
      active: isEntityActive(s.active),
    };
  }

  private slugCode(name: string): string {
    const raw = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 12);
    return raw || 'SERV';
  }

  private async uniqueServiceCode(shopId: string, name: string): Promise<string> {
    const base = `SERV-${this.slugCode(name)}`.slice(0, 24);
    let code = base;
    let n = 1;
    while (await this.accounts.findOne({ where: { shopId, code } })) {
      code = `${base}-${n++}`.slice(0, 32);
    }
    return code;
  }

  async list(user: AuthUser, shopId: string, includeInactive = false) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.services.find({
      where: { shopId },
      relations: ['account'],
      order: { name: 'ASC' },
    });
    const filtered = includeInactive ? rows : rows.filter((r) => isEntityActive(r.active));
    return filtered.map((r) => this.toDto(r));
  }

  async one(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.services.findOne({
      where: { id, shopId },
      relations: ['account'],
    });
    if (!row) throw new NotFoundException('Servicio no encontrado');
    return this.toDto(row);
  }

  async create(
    user: AuthUser,
    shopId: string,
    dto: {
      name: string;
      legalName?: string | null;
      taxId?: string | null;
      bankAlias?: string | null;
      notes?: string | null;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Ingresá el nombre del servicio');

    const code = await this.uniqueServiceCode(shopId, name);
    const account = await this.accounts.save(
      this.accounts.create({
        shopId,
        name: `Servicio: ${name}`,
        code,
        type: LedgerAccountType.SERVICE,
        hideFromCashWithdraw: true,
        listInExpenses: false,
        listInIncomes: false,
        listInTransfers: false,
        active: true,
      }),
    );

    const row = await this.services.save(
      this.services.create({
        shopId,
        name,
        legalName: dto.legalName?.trim() || null,
        taxId: dto.taxId?.trim() || null,
        bankAlias: dto.bankAlias?.trim() || null,
        notes: dto.notes?.trim() || null,
        accountId: account.id,
        active: dto.active ?? true,
      }),
    );

    return this.one(user, shopId, row.id);
  }

  async update(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: {
      name?: string;
      legalName?: string | null;
      taxId?: string | null;
      bankAlias?: string | null;
      notes?: string | null;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.services.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Servicio no encontrado');

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Ingresá el nombre del servicio');
      row.name = name;
      const account = await this.accounts.findOne({ where: { id: row.accountId, shopId } });
      if (account) {
        account.name = `Servicio: ${name}`;
        await this.accounts.save(account);
      }
    }
    if (dto.legalName !== undefined) row.legalName = dto.legalName?.trim() || null;
    if (dto.taxId !== undefined) row.taxId = dto.taxId?.trim() || null;
    if (dto.bankAlias !== undefined) row.bankAlias = dto.bankAlias?.trim() || null;
    if (dto.notes !== undefined) row.notes = dto.notes?.trim() || null;
    if (dto.active !== undefined) {
      row.active = dto.active;
      const account = await this.accounts.findOne({ where: { id: row.accountId, shopId } });
      if (account) {
        account.active = dto.active;
        await this.accounts.save(account);
      }
    }
    await this.services.save(row);
    return this.one(user, shopId, id);
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.services.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Servicio no encontrado');
    row.active = false;
    await this.services.save(row);
    const account = await this.accounts.findOne({ where: { id: row.accountId, shopId } });
    if (account) {
      account.active = false;
      await this.accounts.save(account);
    }
    return { ok: true };
  }
}
