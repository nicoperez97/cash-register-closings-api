import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerAccountUser } from '../../entities/ledger-account-user.entity';
import { Movement } from '../../entities/movement.entity';
import { Concept } from '../../entities/concept.entity';
import { Shop } from '../../entities/shop.entity';
import { User } from '../../entities/user.entity';
import { AuthUser } from '../../common/decorators';
import {
  ConceptKind,
  LedgerAccountType,
  LinkedPaymentMethod,
} from '../../common/enums';
import { ShopsService } from '../shops/shops.service';
import { CatalogSeedService } from '../../common/catalog-seed.service';
import { markDeletedUnique } from '../../common/soft-delete.util';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => v.toFixed(2);
const BALANCE_EPS = 0.01;

export class UpsertAccountDto {
  name: string;
  code: string;
  type?: LedgerAccountType;
  linkedPaymentMethod?: LinkedPaymentMethod | null;
  /** Usuarios asociados (N:N). */
  userIds?: string[] | null;
  /** Compat: un solo usuario. */
  userId?: string | null;
  active?: boolean;
  /** Ocultar en el selector de retiro del cierre. */
  hideFromCashWithdraw?: boolean;
}

@Injectable()
export class AccountsService implements OnModuleInit {
  constructor(
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(LedgerAccountUser)
    private readonly links: Repository<LedgerAccountUser>,
    @InjectRepository(Movement)
    private readonly movements: Repository<Movement>,
    @InjectRepository(Concept)
    private readonly concepts: Repository<Concept>,
    @InjectRepository(Shop) private readonly shopsRepo: Repository<Shop>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly shops: ShopsService,
    private readonly catalogSeed: CatalogSeedService,
  ) {}

  async onModuleInit() {
    try {
      await this.migrateLegacyUserIds();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[AccountsService] Legacy userId migrate failed:', err);
    }
    try {
      await this.accounts.query(`
        ALTER TABLE ledger_accounts
          ADD COLUMN hideFromCashWithdraw TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch {
      // columna ya existe
    }
    try {
      await this.accounts.query(`
        ALTER TABLE ledger_accounts
          MODIFY COLUMN type ENUM('PARTNER', 'CHANNEL', 'SYSTEM', 'SUPPLIER', 'SERVICE')
          NOT NULL DEFAULT 'PARTNER'
      `);
    } catch {
      // enum ya actualizado
    }
  }

  /** Copia ledger_accounts.userId → join table si aún existen filas legacy. */
  private async migrateLegacyUserIds() {
    try {
      await this.accounts.query(`
        INSERT IGNORE INTO ledger_account_users (id, shopId, accountId, userId)
        SELECT UUID(), a.shopId, a.id, a.userId
        FROM ledger_accounts a
        WHERE a.userId IS NOT NULL
          AND (a.deletedAt IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM ledger_account_users l
            WHERE l.accountId = a.id AND l.userId = a.userId
          )
      `);
    } catch {
      // columna userId puede no existir ya
    }
  }

  private async enrich(rows: LedgerAccount[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const links = await this.links.find({ where: { accountId: In(ids) } });
    const userIds = [...new Set(links.map((l) => l.userId))];
    const users = userIds.length
      ? await this.users.find({ where: { id: In(userIds) } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));
    const linksByAccount = new Map<string, LedgerAccountUser[]>();
    for (const l of links) {
      const arr = linksByAccount.get(l.accountId) ?? [];
      arr.push(l);
      linksByAccount.set(l.accountId, arr);
    }
    return rows.map((a) => {
      const alinks = linksByAccount.get(a.id) ?? [];
      const uids = alinks.map((l) => l.userId);
      const names = uids.map((id) => nameById.get(id)).filter(Boolean) as string[];
      return {
        id: a.id,
        shopId: a.shopId,
        name: a.name,
        code: a.code,
        type: a.type,
        linkedPaymentMethod: a.linkedPaymentMethod ?? null,
        hideFromCashWithdraw: !!a.hideFromCashWithdraw,
        userIds: uids,
        userNames: names,
        userFullName: names.join(', ') || null,
        userId: uids[0] ?? null,
        active: !!a.active,
      };
    });
  }

  async list(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.accounts.find({
      where: { shopId, active: true },
      order: { type: 'ASC', name: 'ASC' },
    });
    return this.enrich(rows);
  }

  async create(user: AuthUser, shopId: string, dto: UpsertAccountDto) {
    this.shops.assertShopAccess(user, shopId);
    const code = dto.code.trim().toUpperCase();
    const clash = await this.accounts.findOne({ where: { shopId, code } });
    if (clash) throw new BadRequestException('Ya existe una cuenta con ese código');
    const linkedPaymentMethod = dto.linkedPaymentMethod ?? null;
    if (linkedPaymentMethod) {
      await this.clearLinkedPaymentMethod(shopId, linkedPaymentMethod);
    }
    const row = await this.accounts.save(
      this.accounts.create({
        shopId,
        name: dto.name.trim(),
        code,
        type: dto.type ?? LedgerAccountType.PARTNER,
        linkedPaymentMethod,
        hideFromCashWithdraw:
          dto.type === LedgerAccountType.SUPPLIER || dto.type === LedgerAccountType.SERVICE
            ? true
            : !!dto.hideFromCashWithdraw,
        active: dto.active ?? true,
      }),
    );
    const userIds = this.normalizeUserIds(dto);
    if (userIds.length) await this.replaceUserLinks(shopId, row.id, userIds);
    return (await this.enrich([row]))[0];
  }

  async update(user: AuthUser, shopId: string, id: string, dto: Partial<UpsertAccountDto>) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.accounts.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Cuenta no encontrada');
    if (dto.name !== undefined) row.name = dto.name.trim();
    if (dto.code !== undefined) {
      const code = dto.code.trim().toUpperCase();
      const clash = await this.accounts.findOne({ where: { shopId, code } });
      if (clash && clash.id !== id) {
        throw new BadRequestException('Ya existe una cuenta con ese código');
      }
      row.code = code;
    }
    if (dto.type !== undefined) row.type = dto.type;
    if (dto.linkedPaymentMethod !== undefined) {
      const method = dto.linkedPaymentMethod;
      if (method) {
        await this.clearLinkedPaymentMethod(shopId, method, id);
      }
      row.linkedPaymentMethod = method;
    }
    if (dto.hideFromCashWithdraw !== undefined) {
      row.hideFromCashWithdraw = !!dto.hideFromCashWithdraw;
    }
    if (row.type === LedgerAccountType.SUPPLIER || row.type === LedgerAccountType.SERVICE) {
      row.hideFromCashWithdraw = true;
    }
    if (dto.active !== undefined) row.active = dto.active;
    await this.accounts.save(row);
    if (dto.userIds !== undefined || dto.userId !== undefined) {
      await this.replaceUserLinks(shopId, id, this.normalizeUserIds(dto));
    }
    return (await this.enrich([row]))[0];
  }

  /**
   * Asigna qué cuenta CHANNEL recibe cada campo del cierre
   * (PVS, Mercado Pago, efectivo, etc.). Un medio → una sola cuenta.
   */
  async setPaymentDeposits(
    user: AuthUser,
    shopId: string,
    map: Partial<Record<LinkedPaymentMethod, string | null>>,
  ) {
    this.shops.assertShopAccess(user, shopId);
    const methods = Object.values(LinkedPaymentMethod);
    for (const method of methods) {
      if (!(method in map)) continue;
      const accountId = map[method]?.trim() || null;
      await this.clearLinkedPaymentMethod(shopId, method);
      if (!accountId) continue;
      const row = await this.accounts.findOne({
        where: { id: accountId, shopId, active: true },
      });
      if (!row) {
        throw new BadRequestException(`Cuenta no encontrada para ${method}`);
      }
      if (row.type === LedgerAccountType.SYSTEM) {
        throw new BadRequestException('No se puede vincular un medio a una cuenta de sistema');
      }
      row.linkedPaymentMethod = method;
      await this.accounts.save(row);
    }
    return this.list(user, shopId);
  }

  /** Quita el medio de todas las cuentas del local (opcionalmente excepto una). */
  private async clearLinkedPaymentMethod(
    shopId: string,
    method: LinkedPaymentMethod,
    exceptAccountId?: string,
  ) {
    const qb = this.accounts
      .createQueryBuilder()
      .update(LedgerAccount)
      .set({ linkedPaymentMethod: null })
      .where('shopId = :shopId', { shopId })
      .andWhere('linkedPaymentMethod = :method', { method });
    if (exceptAccountId) {
      qb.andWhere('id != :exceptAccountId', { exceptAccountId });
    }
    await qb.execute();
  }

  async balanceOf(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.accounts.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Cuenta no encontrada');
    const balance = await this.computeBalance(shopId, id);
    return {
      accountId: row.id,
      name: row.name,
      balance,
    };
  }

  async remove(
    user: AuthUser,
    shopId: string,
    id: string,
    transferToAccountId?: string | null,
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.accounts.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Cuenta no encontrada');
    if (row.type === LedgerAccountType.SYSTEM) {
      throw new BadRequestException('No se pueden eliminar cuentas de sistema');
    }

    const balance = await this.computeBalance(shopId, id);
    if (Math.abs(balance) >= BALANCE_EPS) {
      const destId = transferToAccountId?.trim() || null;
      if (!destId) {
        throw new BadRequestException({
          message: `La cuenta tiene saldo ${money(balance)}. Elegí a qué cuenta transferirlo.`,
          code: 'HAS_BALANCE',
          balance,
        });
      }
      if (destId === id) {
        throw new BadRequestException('La cuenta destino debe ser distinta');
      }
      const dest = await this.accounts.findOne({
        where: { id: destId, shopId, active: true },
      });
      if (!dest) throw new BadRequestException('Cuenta destino no encontrada');
      if (dest.type === LedgerAccountType.SYSTEM) {
        throw new BadRequestException('No se puede transferir a una cuenta de sistema');
      }
      await this.createBalanceTransfer(shopId, row, dest, balance);
    }

    await this.links.delete({ accountId: id });
    row.code = markDeletedUnique(row.code, row.id);
    row.active = false;
    row.linkedPaymentMethod = null;
    await this.accounts.save(row);
    await this.accounts.softRemove(row);
    return { ok: true, transferredBalance: Math.abs(balance) >= BALANCE_EPS ? balance : 0 };
  }

  private async computeBalance(shopId: string, accountId: string): Promise<number> {
    const rows = await this.movements
      .createQueryBuilder('m')
      .where('m.shopId = :shopId', { shopId })
      .andWhere('m.active = true')
      .andWhere('(m.fromAccountId = :id OR m.toAccountId = :id)', { id: accountId })
      .getMany();
    let income = 0;
    let expense = 0;
    for (const r of rows) {
      const amt = n(r.amountUyu);
      if (r.fromAccountId === accountId) expense += amt;
      if (r.toAccountId === accountId) income += amt;
    }
    return Math.round((income - expense) * 100) / 100;
  }

  private async createBalanceTransfer(
    shopId: string,
    source: LedgerAccount,
    dest: LedgerAccount,
    balance: number,
  ) {
    const concept =
      (await this.concepts.findOne({
        where: { shopId, name: 'Transferencia e/ cuentas', active: true },
      })) ??
      (await this.concepts.findOne({
        where: { shopId, kind: ConceptKind.TRANSFER, active: true },
      }));

    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const amount = Math.abs(balance);
    // Saldo + : fondos en la cuenta → sale hacia destino.
    // Saldo − : la cuenta debe → entra desde destino para dejarla en cero.
    const fromAccountId = balance > 0 ? source.id : dest.id;
    const toAccountId = balance > 0 ? dest.id : source.id;

    await this.movements.save(
      this.movements.create({
        shopId,
        businessDate: `${y}-${m}-${d}`,
        fromAccountId,
        toAccountId,
        amountUyu: money(amount),
        conceptId: concept?.id ?? null,
        description: `Transferencia por eliminación de cuenta «${source.name}»`,
        active: true,
      }),
    );
  }

  private normalizeUserIds(dto: Partial<UpsertAccountDto>): string[] {
    if (dto.userIds !== undefined) {
      return [...new Set((dto.userIds ?? []).filter(Boolean))];
    }
    if (dto.userId) return [dto.userId];
    return [];
  }

  private async replaceUserLinks(shopId: string, accountId: string, userIds: string[]) {
    for (const userId of userIds) {
      const user = await this.users.findOne({ where: { id: userId, active: true } });
      if (!user) throw new BadRequestException(`Usuario no encontrado: ${userId}`);
    }
    await this.links.delete({ accountId });
    if (!userIds.length) return;
    await this.links.save(
      userIds.map((userId) =>
        this.links.create({ shopId, accountId, userId }),
      ),
    );
  }

  /**
   * Resuelve la cuenta PARTNER del usuario para el retiro de efectivo del cierre.
   * - Si se indica preferredAccountId, debe estar asociada al usuario.
   * - Si no tiene cuentas, crea una PARTNER con su nombre y la asocia.
   * - Si tiene varias y no eligió, lanza BadRequest.
   */
  async resolvePartnerAccountForUser(
    shopId: string,
    userId: string,
    preferredAccountId?: string | null,
  ): Promise<LedgerAccount> {
    const user = await this.users.findOne({ where: { id: userId, active: true } });
    if (!user) throw new BadRequestException('Usuario del retiro no encontrado');

    const links = await this.links.find({ where: { shopId, userId } });
    const accountIds = links.map((l) => l.accountId);
    const linked = accountIds.length
      ? await this.accounts.find({
          where: { shopId, id: In(accountIds), active: true },
          order: { name: 'ASC' },
        })
      : [];
    // Preferimos PARTNER visibles en retiro; si solo tiene CHANNEL/SYSTEM, las usamos igual.
    const partners = linked.filter(
      (a) => a.type === LedgerAccountType.PARTNER && !a.hideFromCashWithdraw,
    );
    const candidates = partners.length
      ? partners
      : linked.filter((a) => !a.hideFromCashWithdraw);

    if (preferredAccountId) {
      const chosen = linked.find((a) => a.id === preferredAccountId);
      if (!chosen) {
        throw new BadRequestException(
          'La cuenta elegida no está asociada al usuario que se lleva el efectivo',
        );
      }
      if (chosen.hideFromCashWithdraw) {
        throw new BadRequestException(
          'Esa cuenta está oculta para el retiro de efectivo; elegí otra',
        );
      }
      return chosen;
    }

    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      throw new BadRequestException(
        'El usuario tiene varias cuentas asociadas; seleccioná a cuál va el efectivo',
      );
    }

    // Sin cuentas visibles: crear PARTNER y asociar.
    const baseCode = this.partnerCodeFromName(user.fullName);
    let code = baseCode;
    let suffix = 2;
    while (await this.accounts.findOne({ where: { shopId, code } })) {
      code = `${baseCode}_${suffix}`.slice(0, 40);
      suffix += 1;
    }
    const row = await this.accounts.save(
      this.accounts.create({
        shopId,
        name: user.fullName.trim() || 'Socio',
        code,
        type: LedgerAccountType.PARTNER,
        linkedPaymentMethod: null,
        hideFromCashWithdraw: false,
        active: true,
      }),
    );
    await this.replaceUserLinks(shopId, row.id, [userId]);
    return row;
  }

  private partnerCodeFromName(fullName: string): string {
    const slug = fullName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 28);
    return slug || 'SOCIO';
  }
}
