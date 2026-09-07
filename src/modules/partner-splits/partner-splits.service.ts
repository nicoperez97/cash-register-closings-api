import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PartnerSplitConfig } from '../../entities/partner-split-config.entity';
import { PartnerSplitRun } from '../../entities/partner-split-run.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerAccountUser } from '../../entities/ledger-account-user.entity';
import { Movement } from '../../entities/movement.entity';
import { Payment } from '../../entities/payment.entity';
import { AuthUser } from '../../common/decorators';
import { LedgerAccountType, PaymentStatus } from '../../common/enums';
import { parseCommissionPercent } from '../../common/account-commission';
import { ShopsService } from '../shops/shops.service';
import { MovementsService } from '../movements/movements.service';
import { CatalogSeedService } from '../../common/catalog-seed.service';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => (Math.round(Number(v || 0) * 100) / 100).toFixed(2);
const round2 = (v: number) => Math.round(Number(v || 0) * 100) / 100;
const PCT_EPS = 0.01;
const EMPTY_EXTRA = { id: 'extra-1', label: '', amount: 0 };
const PLACEHOLDER_EXTRA_IDS = new Set(['fixed', 'working']);
const PLACEHOLDER_EXTRA_LABELS = new Set([
  'Gastos fijos a saldar',
  'Capital de trabajo (proveedores 1 sem)',
]);

function isPlaceholderExtras(
  extras?: Array<{ id?: string; label?: string; amount?: number }>,
) {
  return (
    !!extras?.length &&
    extras.every(
      (e) =>
        n(e.amount) === 0 &&
        (PLACEHOLDER_EXTRA_IDS.has(String(e.id)) ||
          PLACEHOLDER_EXTRA_LABELS.has(String(e.label ?? '').trim())),
    )
  );
}

export type PartnerSplitConfigDto = {
  partnerAccountIds: string[];
  channelLeaves: Array<{ accountId: string; leaveAmount: number }>;
  extras: Array<{ id: string; label: string; amount: number }>;
  partnerActions?: Array<{
    accountId?: string;
    fromAccountId?: string;
    toAccountId?: string;
    generate: 'skip' | 'payment' | 'movement';
  }>;
  partnerComplete?: Array<{
    accountId?: string;
    fromAccountId?: string;
    toAccountId?: string;
    complete: boolean;
  }>;
};

@Injectable()
export class PartnerSplitsService implements OnModuleInit {
  constructor(
    @InjectRepository(PartnerSplitConfig)
    private readonly configs: Repository<PartnerSplitConfig>,
    @InjectRepository(PartnerSplitRun)
    private readonly runs: Repository<PartnerSplitRun>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(Movement) private readonly movementsRepo: Repository<Movement>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(LedgerAccountUser)
    private readonly accountLinks: Repository<LedgerAccountUser>,
    private readonly shops: ShopsService,
    private readonly movements: MovementsService,
    private readonly catalogSeed: CatalogSeedService,
  ) {}

  async onModuleInit() {
    try {
      await this.runs.query(`
        CREATE TABLE IF NOT EXISTS partner_split_runs (
          id CHAR(36) NOT NULL PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          appliedAt DATETIME(6) NOT NULL,
          appliedByUserId CHAR(36) NULL,
          appliedByName VARCHAR(160) NULL,
          transferCount INT NOT NULL DEFAULT 0,
          distributedAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
          snapshot JSON NOT NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX idx_partner_split_runs_shop (shopId)
        )
      `);
    } catch {
      // ya existe
    }
  }

  async getPreview(user: AuthUser, shopId: string, incoming?: Partial<PartnerSplitConfigDto>) {
        this.shops.assertShopAccess(user, shopId);
    const config = await this.resolveConfig(shopId, incoming);
    return this.buildPreview(user, shopId, config);
  }

  async saveConfig(user: AuthUser, shopId: string, incoming: PartnerSplitConfigDto) {
        this.shops.assertShopAccess(user, shopId);
    const config = this.normalizeConfig(incoming);
    let row = await this.configs.findOne({ where: { shopId, active: true } });
    if (!row) {
      row = this.configs.create({ shopId, active: true });
    }
    row.partnerAccountIds = config.partnerAccountIds;
    row.channelLeaves = config.channelLeaves;
    row.extras = config.extras;
    await this.configs.save(row);
    return this.buildPreview(user, shopId, config);
  }

  async apply(user: AuthUser, shopId: string, incoming?: Partial<PartnerSplitConfigDto>) {
        this.shops.assertShopAccess(user, shopId);
    const preview = await this.buildPreview(
      user,
      shopId,
      await this.resolveConfig(shopId, incoming),
    );
    const transfers = preview.transfers ?? [];
    if (!transfers.length) {
      throw new BadRequestException('No hay diferencias para saldar');
    }
    const today = new Date().toISOString().slice(0, 10);
    const partnerIds = new Set((preview.partners ?? []).map((p) => p.accountId));
    const actions = incoming?.partnerActions ?? [];
    const completes = incoming?.partnerComplete ?? [];
    const createdMovementIds: string[] = [];
    const createdPaymentIds: string[] = [];
    let distributed = 0;
    for (const t of transfers) {
      const betweenPartners =
        partnerIds.has(t.fromAccountId) && partnerIds.has(t.toAccountId);
      if (betweenPartners) {
        const mode = this.generateOf(t, actions);
        if (mode === 'skip') continue;
        if (mode === 'payment') {
          const pay = await this.payments.save(
            this.payments.create({
              shopId,
              title: `División · ${t.fromName} → ${t.toName}`,
              notes: `División de socios · sale de ${t.fromName} · entra a ${t.toName}`,
              amount: money(t.amount),
              accountId: t.fromAccountId,
              toAccountId: t.toAccountId,
              status: PaymentStatus.VALIDATED,
              validatedAt: new Date(),
              validatedByUserId: user.id,
              createdByUserId: user.id,
              active: true,
            }),
          );
          createdPaymentIds.push(pay.id);
          distributed = round2(distributed + n(t.amount));
          continue;
        }
      } else if (!this.isComplete(t, completes)) {
        continue;
      }
      const row = await this.movementsRepo.save(
        this.movementsRepo.create({
          shopId,
          businessDate: today,
          fromAccountId: t.fromAccountId,
          toAccountId: t.toAccountId,
          description: `División de socios · ${t.fromName} → ${t.toName}`,
          amountUyu: money(t.amount),
          invoiced: false,
          active: true,
        }),
      );
      createdMovementIds.push(row.id);
      distributed = round2(distributed + n(t.amount));
    }
    const created = [...createdMovementIds, ...createdPaymentIds];
    if (!created.length) {
      throw new BadRequestException(
        'Elegí Pago o Movimiento en un pase entre socios, o Completo en un canal',
      );
    }
    await this.saveConfig(user, shopId, preview.config);
    const run = await this.runs.save(
      this.runs.create({
        shopId,
        appliedAt: new Date(),
        appliedByUserId: user.id,
        appliedByName: user.fullName || user.email || null,
        transferCount: created.length,
        distributedAmount: money(distributed),
        snapshot: {
          config: preview.config,
          partners: preview.partners,
          channels: preview.channels,
          extras: preview.extras,
          totals: preview.totals,
          transfers: preview.transfers,
          createdIds: created,
          createdMovementIds: createdMovementIds,
          createdPaymentIds: createdPaymentIds,
          partnerActions: incoming?.partnerActions ?? [],
          partnerComplete: incoming?.partnerComplete ?? [],
        },
      }),
    );
    const after = await this.buildPreview(user, shopId, preview.config);
    return {
      createdCount: created.length,
      createdIds: created,
      createdMovementCount: createdMovementIds.length,
      createdPaymentCount: createdPaymentIds.length,
      runId: run.id,
      ...after,
    };
  }

  async listRuns(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.runs.find({
      where: { shopId, active: true },
      order: { appliedAt: 'DESC' },
      take: 200,
    });
    return rows.map((r) => this.toRunDto(r, false));
  }

  async getRun(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.runs.findOne({ where: { id, shopId, active: true } });
    if (!row) throw new BadRequestException('División no encontrada');
    return this.toRunDto(row, true);
  }

  async saveOwnership(
    user: AuthUser,
    shopId: string,
    items: Array<{ accountId: string; ownershipPercent: number }>,
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (!items?.length) throw new BadRequestException('Sin cambios de %');
    const ids = [...new Set(items.map((i) => i.accountId).filter(Boolean))];
    const rows = await this.accounts.find({
      where: { shopId, active: true, type: LedgerAccountType.PARTNER },
    });
    const byId = new Map(rows.map((a) => [a.id, a]));
    for (const item of items) {
      const row = byId.get(item.accountId);
      if (!row) throw new BadRequestException(`Cuenta socio no encontrada: ${item.accountId}`);
      row.ownershipPercent = money(parseCommissionPercent(item.ownershipPercent));
    }
    await this.accounts.save([...byId.values()].filter((a) => ids.includes(a.id)));
    return rows
      .filter((a) => ids.includes(a.id))
      .map((a) => ({
        accountId: a.id,
        name: a.name,
        ownershipPercent: parseCommissionPercent(a.ownershipPercent),
      }));
  }

  async equalizePreview(
    user: AuthUser,
    shopId: string,
    body: { amount: number; partnerAccountIds?: string[] },
  ) {
    this.shops.assertShopAccess(user, shopId);
    return this.buildEqualizePreview(user, shopId, body);
  }

  async equalizeApply(
    user: AuthUser,
    shopId: string,
    body: {
      amount: number;
      partnerAccountIds?: string[];
      transferActions?: Array<{
        accountId?: string;
        fromAccountId?: string;
        toAccountId?: string;
        generate: 'skip' | 'payment' | 'movement';
      }>;
      sendSurplusToDividends?: boolean;
      sendBalancedToDividends?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (!(round2(n(body.amount)) > 0)) {
      throw new BadRequestException('Ingresá un monto mayor a cero');
    }
    const preview = await this.buildEqualizePreview(user, shopId, body);
    const transfers = preview.transfers ?? [];
    const actions = body.transferActions ?? [];
    const sendSurplus = !!body.sendSurplusToDividends;
    const sendBalanced = !!body.sendBalancedToDividends;
    const today = new Date().toISOString().slice(0, 10);
    const createdPaymentIds: string[] = [];
    const createdMovementIds: string[] = [];
    let distributed = 0;

    const dividends = await this.catalogSeed.ensureDividendsAccount(shopId);

    if (sendBalanced) {
      if (preview.transferStatus !== 'balanced') {
        throw new BadRequestException(
          'Solo podés enviar la división a Dividendos cuando los saldos ya coinciden con el objetivo',
        );
      }
      const rows = (preview.partners ?? []).filter((p) => p.current > 0.004);
      if (!rows.length) {
        throw new BadRequestException('No hay saldos de socios para enviar a Dividendos');
      }
      for (const p of rows) {
        const amount = round2(p.current);
        if (!(amount > 0.004)) continue;
        const row = await this.movementsRepo.save(
          this.movementsRepo.create({
            shopId,
            businessDate: today,
            fromAccountId: p.accountId,
            toAccountId: dividends.id,
            description: `Equilibrar · división → Dividendos · ${p.name}`,
            amountUyu: money(amount),
            invoiced: false,
            active: true,
          }),
        );
        createdMovementIds.push(row.id);
        distributed = round2(distributed + amount);
      }
    } else if (sendSurplus) {
      const surplusRows = (preview.partners ?? []).filter((p) => p.difference < -0.004);
      if (!surplusRows.length) {
        throw new BadRequestException('No hay sobrante para enviar a Dividendos');
      }
      for (const p of surplusRows) {
        const amount = round2(-p.difference);
        if (!(amount > 0.004)) continue;
        const row = await this.movementsRepo.save(
          this.movementsRepo.create({
            shopId,
            businessDate: today,
            fromAccountId: p.accountId,
            toAccountId: dividends.id,
            description: `Equilibrar · sobrante → Dividendos · ${p.name}`,
            amountUyu: money(amount),
            invoiced: false,
            active: true,
          }),
        );
        createdMovementIds.push(row.id);
        distributed = round2(distributed + amount);
      }
    } else {
      if (!transfers.length) {
        throw new BadRequestException(
          preview.transferStatus === 'balanced'
            ? 'Los saldos ya coinciden: no hay pases. Podés enviar esa división a Dividendos para sacarla de los saldos del local.'
            : preview.surplusTotal > 0.004 && preview.deficitTotal < 0.004
              ? 'Todos tienen sobrante respecto al objetivo: no hay pases entre socios. Subí el monto, o enviá el sobrante a Dividendos.'
              : 'No hay diferencias para saldar',
        );
      }
      for (const t of transfers) {
        const mode = actions.length ? this.generateOf(t, actions) : 'payment';
        if (mode === 'skip') continue;
        // Destino del dinero: siempre Dividendos. El socio receptor queda anotado, sin sumar saldo.
        if (mode === 'payment') {
          const pay = await this.payments.save(
            this.payments.create({
              shopId,
              title: `Equilibrar · Dividendo · ${t.fromName} → ${t.toName}`,
              notes: `Al abonar va a Dividendos · anotado para ${t.toName} · no le suma saldo · sale de ${t.fromName}`,
              amount: money(t.amount),
              accountId: t.fromAccountId,
              toAccountId: t.toAccountId,
              isDividend: true,
              status: PaymentStatus.VALIDATED,
              validatedAt: new Date(),
              validatedByUserId: user.id,
              createdByUserId: user.id,
              active: true,
            }),
          );
          createdPaymentIds.push(pay.id);
          distributed = round2(distributed + n(t.amount));
          continue;
        }
        const link = await this.accountLinks.findOne({
          where: { shopId, accountId: t.toAccountId },
        });
        const row = await this.movementsRepo.save(
          this.movementsRepo.create({
            shopId,
            businessDate: today,
            fromAccountId: t.fromAccountId,
            toAccountId: dividends.id,
            beneficiaryAccountId: t.toAccountId,
            toUserId: link?.userId ?? null,
            description: `Equilibrar · Dividendo · ${t.fromName} → ${t.toName}`,
            amountUyu: money(t.amount),
            invoiced: false,
            active: true,
          }),
        );
        createdMovementIds.push(row.id);
        distributed = round2(distributed + n(t.amount));
      }
    }

    const created = [...createdPaymentIds, ...createdMovementIds];
    if (!created.length) {
      throw new BadRequestException(
        sendBalanced
          ? 'No se pudo enviar la división a Dividendos'
          : sendSurplus
            ? 'No se pudo enviar sobrante a Dividendos'
            : 'Elegí Pago o Movimiento en al menos un pase',
      );
    }

    const run = await this.runs.save(
      this.runs.create({
        shopId,
        appliedAt: new Date(),
        appliedByUserId: user.id,
        appliedByName: user.fullName || user.email || null,
        transferCount: created.length,
        distributedAmount: money(distributed),
        snapshot: {
          kind: 'equalize',
          amount: preview.amount,
          partners: preview.partners,
          totals: preview.totals,
          transfers: preview.transfers,
          surplusTotal: preview.surplusTotal,
          deficitTotal: preview.deficitTotal,
          transferStatus: preview.transferStatus,
          sendSurplusToDividends: sendSurplus,
          sendBalancedToDividends: sendBalanced,
          applyAsDividends: true,
          partnerActions: actions,
          createdIds: created,
          createdPaymentIds,
          createdMovementIds,
        },
      }),
    );
    const after = await this.buildEqualizePreview(user, shopId, {
      amount: body.amount,
      partnerAccountIds: preview.partners.map((p) => p.accountId),
    });
    return {
      createdCount: created.length,
      createdPaymentCount: createdPaymentIds.length,
      createdMovementCount: createdMovementIds.length,
      createdIds: created,
      runId: run.id,
      ...after,
    };
  }

  private async buildEqualizePreview(
    user: AuthUser,
    shopId: string,
    body: { amount: number; partnerAccountIds?: string[] },
  ) {
    const amount = round2(n(body.amount));
    if (!(amount >= 0)) {
      throw new BadRequestException('Monto inválido');
    }
    const balances = await this.movements.balances(user, shopId, { scope: 'all' });
    const byId = new Map((balances.accounts ?? []).map((a) => [a.accountId, a]));
    const accounts = await this.accounts.find({
      where: { shopId, active: true, type: LedgerAccountType.PARTNER },
      order: { name: 'ASC' },
    });
    if (!accounts.length) {
      throw new BadRequestException('No hay cuentas de socio en este local');
    }
    const requested = (body.partnerAccountIds ?? []).filter(Boolean);
    const included = requested.length
      ? accounts.filter((a) => requested.includes(a.id))
      : accounts;
    if (!included.length) {
      throw new BadRequestException('Elegí al menos un socio');
    }

    let percents = included.map((a) => ({
      accountId: a.id,
      name: a.name,
      ownershipPercent: parseCommissionPercent(a.ownershipPercent),
      current: round2(n(byId.get(a.id)?.balance)),
      proposed: false,
    }));

    const storedSum = round2(percents.reduce((s, p) => s + p.ownershipPercent, 0));
    const allZero = percents.every((p) => p.ownershipPercent <= 0);
    if (allZero) {
      const count = percents.length;
      const base = round2(100 / count);
      percents = percents.map((p, i) => ({
        ...p,
        ownershipPercent: i === count - 1 ? round2(100 - base * (count - 1)) : base,
        proposed: true,
      }));
    } else if (Math.abs(storedSum - 100) > PCT_EPS) {
      throw new BadRequestException(
        `Los % de los socios deben sumar 100 (ahora ${storedSum.toFixed(2)})`,
      );
    }

    const partners = percents.map((p) => {
      const rawTarget = round2((amount * p.ownershipPercent) / 100);
      return {
        accountId: p.accountId,
        name: p.name,
        current: p.current,
        ownershipPercent: p.ownershipPercent,
        proposedPercent: p.proposed,
        target: rawTarget,
        difference: round2(rawTarget - p.current),
      };
    });

    // Ajuste de centavos: el último socio absorbe la diferencia vs el monto
    const targetsSum = round2(partners.reduce((s, p) => s + p.target, 0));
    const drift = round2(amount - targetsSum);
    if (Math.abs(drift) >= 0.01 && partners.length) {
      const last = partners[partners.length - 1];
      last.target = round2(last.target + drift);
      last.difference = round2(last.target - last.current);
    }

    const transfers = this.planTransfers(
      partners.map((p) => ({
        accountId: p.accountId,
        name: p.name,
        difference: p.difference,
      })),
    );

    const surplusTotal = round2(
      partners.filter((p) => p.difference < -0.004).reduce((s, p) => s + -p.difference, 0),
    );
    const deficitTotal = round2(
      partners.filter((p) => p.difference > 0.004).reduce((s, p) => s + p.difference, 0),
    );
    let transferStatus: 'need_amount' | 'balanced' | 'transfers' | 'surplus_only' | 'deficit_only' =
      'balanced';
    if (!(amount > 0)) transferStatus = 'need_amount';
    else if (transfers.length) transferStatus = 'transfers';
    else if (surplusTotal > 0.004 && deficitTotal < 0.004) transferStatus = 'surplus_only';
    else if (deficitTotal > 0.004 && surplusTotal < 0.004) transferStatus = 'deficit_only';

    return {
      kind: 'equalize' as const,
      amount,
      partners,
      totals: {
        amount,
        ownershipSum: round2(partners.reduce((s, p) => s + p.ownershipPercent, 0)),
        balances: round2(partners.reduce((s, p) => s + p.current, 0)),
        targets: round2(partners.reduce((s, p) => s + p.target, 0)),
        differences: round2(partners.reduce((s, p) => s + p.difference, 0)),
        transferCount: transfers.length,
        transferAmount: round2(transfers.reduce((s, t) => s + t.amount, 0)),
      },
      transfers,
      surplusTotal,
      deficitTotal,
      transferStatus,
      proposedEqualPercents: allZero,
    };
  }

  private toRunDto(row: PartnerSplitRun, withSnapshot: boolean) {
    const snap = row.snapshot as { kind?: string } | null;
    return {
      id: row.id,
      shopId: row.shopId,
      appliedAt: row.appliedAt,
      appliedByUserId: row.appliedByUserId ?? null,
      appliedByName: row.appliedByName ?? null,
      transferCount: row.transferCount,
      distributedAmount: n(row.distributedAmount),
      kind: snap?.kind === 'equalize' ? 'equalize' : 'split',
      ...(withSnapshot ? { snapshot: row.snapshot } : {}),
    };
  }

  private async resolveConfig(
    shopId: string,
    incoming?: Partial<PartnerSplitConfigDto>,
  ): Promise<PartnerSplitConfigDto> {
    const saved = await this.configs.findOne({ where: { shopId, active: true } });
    const accounts = await this.accounts.find({ where: { shopId, active: true } });
    const partners = accounts.filter((a) => a.type === LedgerAccountType.PARTNER);
    const channels = accounts.filter((a) => a.type === LedgerAccountType.CHANNEL);
    const base: PartnerSplitConfigDto = {
      partnerAccountIds:
        saved?.partnerAccountIds?.length
          ? saved.partnerAccountIds
          : partners.map((a) => a.id),
      channelLeaves:
        saved?.channelLeaves?.length
          ? saved.channelLeaves
          : channels.map((a) => ({ accountId: a.id, leaveAmount: 0 })),
      extras:
        saved?.extras?.length && !isPlaceholderExtras(saved.extras)
          ? saved.extras
          : [{ ...EMPTY_EXTRA }],
    };
    return this.normalizeConfig({
      partnerAccountIds: incoming?.partnerAccountIds ?? base.partnerAccountIds,
      channelLeaves: incoming?.channelLeaves ?? base.channelLeaves,
      extras: incoming?.extras ?? base.extras,
    });
  }

  private normalizeConfig(config: PartnerSplitConfigDto): PartnerSplitConfigDto {
    return {
      partnerAccountIds: [...new Set((config.partnerAccountIds ?? []).filter(Boolean))],
      channelLeaves: (config.channelLeaves ?? []).map((c) => ({
        accountId: c.accountId,
        leaveAmount: Math.max(0, round2(n(c.leaveAmount))),
      })),
      extras: (config.extras ?? []).map((e, i) => ({
        id: e.id || `extra-${i + 1}`,
        label: String(e.label ?? '').trim(),
        amount: round2(n(e.amount)),
      })),
    };
  }

  private async buildPreview(user: AuthUser, shopId: string, config: PartnerSplitConfigDto) {
    const balances = await this.movements.balances(user, shopId, { scope: 'all' });
    const byId = new Map((balances.accounts ?? []).map((a) => [a.accountId, a]));
    const accounts = await this.accounts.find({ where: { shopId, active: true } });
    const partnerAccs = accounts.filter((a) => a.type === LedgerAccountType.PARTNER);
    const channelAccs = accounts.filter((a) => a.type === LedgerAccountType.CHANNEL);

    const includedPartners = partnerAccs.filter((a) =>
      config.partnerAccountIds.includes(a.id),
    );
    if (!includedPartners.length) {
      throw new BadRequestException('Elegí al menos un socio');
    }

    const leaveOf = (accountId: string) =>
      config.channelLeaves.find((c) => c.accountId === accountId)?.leaveAmount ?? 0;

    const partners = includedPartners.map((a) => {
      const current = round2(n(byId.get(a.id)?.balance));
      return { accountId: a.id, name: a.name, current, leaveAmount: leaveOf(a.id) };
    });
    const channels = channelAccs.map((a) => {
      const current = round2(n(byId.get(a.id)?.balance));
      return { accountId: a.id, name: a.name, current, leaveAmount: leaveOf(a.id) };
    });

    const extrasTotal = round2(config.extras.reduce((s, e) => s + n(e.amount), 0));
    const balancesTotal = round2(
      partners.reduce((s, p) => s + p.current, 0) +
        channels.reduce((s, c) => s + c.current, 0),
    );
    const reserves = round2(
      partners.reduce((s, p) => s + p.leaveAmount, 0) +
        channels.reduce((s, c) => s + c.leaveAmount, 0),
    );
    const toDistribute = round2(balancesTotal - reserves - extrasTotal);
    const count = partners.length;
    const shareBase = count ? round2(toDistribute / count) : 0;
    const shareLast = count ? round2(toDistribute - shareBase * (count - 1)) : 0;

    const partnerRows = partners.map((p, i) => {
      const share = i === count - 1 ? shareLast : shareBase;
      const target = round2(share + p.leaveAmount);
      return {
        ...p,
        included: true,
        target,
        share,
        difference: round2(target - p.current),
      };
    });
    const channelRows = channels.map((c) => ({
      ...c,
      target: c.leaveAmount,
      difference: round2(c.leaveAmount - c.current),
    }));

    const transfers = this.planTransfers([
      ...partnerRows.map((p) => ({
        accountId: p.accountId,
        name: p.name,
        difference: p.difference,
      })),
      ...channelRows.map((c) => ({
        accountId: c.accountId,
        name: c.name,
        difference: c.difference,
      })),
    ]);

    return {
      config,
      partners: partnerRows,
      channels: channelRows,
      extras: config.extras,
      availablePartners: partnerAccs.map((a) => ({
        accountId: a.id,
        name: a.name,
        included: config.partnerAccountIds.includes(a.id),
        current: round2(n(byId.get(a.id)?.balance)),
      })),
      totals: {
        balances: balancesTotal,
        reserves,
        extras: extrasTotal,
        toDistribute,
        share: shareBase,
        differences: round2(
          [...partnerRows, ...channelRows].reduce((s, r) => s + r.difference, 0),
        ),
      },
      transfers,
    };
  }

  private isComplete(
    t: { fromAccountId: string; toAccountId: string },
    completes: NonNullable<PartnerSplitConfigDto['partnerComplete']>,
  ): boolean {
    const exact = completes.find(
      (a) => a.fromAccountId === t.fromAccountId && a.toAccountId === t.toAccountId,
    );
    if (exact) return !!exact.complete;
    return completes.some(
      (a) =>
        !!a.complete &&
        (a.accountId === t.toAccountId || a.accountId === t.fromAccountId),
    );
  }

  private generateOf(
    t: { fromAccountId: string; toAccountId: string },
    actions: NonNullable<PartnerSplitConfigDto['partnerActions']>,
  ): 'skip' | 'payment' | 'movement' {
    const exact = actions.find(
      (a) => a.fromAccountId === t.fromAccountId && a.toAccountId === t.toAccountId,
    );
    if (exact?.generate === 'payment' || exact?.generate === 'movement' || exact?.generate === 'skip') {
      return exact.generate;
    }
    const from = actions.find((a) => a.accountId === t.fromAccountId);
    const to = actions.find((a) => a.accountId === t.toAccountId);
    if (from?.generate === 'payment' || to?.generate === 'payment') return 'payment';
    if (from?.generate === 'movement' || to?.generate === 'movement') return 'movement';
    return 'skip';
  }

  private planTransfers(
    rows: Array<{ accountId: string; name: string; difference: number }>,
  ) {
    const payers = rows
      .filter((r) => r.difference < -0.004)
      .map((r) => ({ ...r, left: round2(-r.difference) }));
    const receivers = rows
      .filter((r) => r.difference > 0.004)
      .map((r) => ({ ...r, left: round2(r.difference) }));
    const transfers: Array<{
      fromAccountId: string;
      fromName: string;
      toAccountId: string;
      toName: string;
      amount: number;
    }> = [];
    let i = 0;
    let j = 0;
    while (i < payers.length && j < receivers.length) {
      const from = payers[i];
      const to = receivers[j];
      const amount = round2(Math.min(from.left, to.left));
      if (amount > 0.004) {
        transfers.push({
          fromAccountId: from.accountId,
          fromName: from.name,
          toAccountId: to.accountId,
          toName: to.name,
          amount,
        });
        from.left = round2(from.left - amount);
        to.left = round2(to.left - amount);
      }
      if (from.left <= 0.004) i += 1;
      if (to.left <= 0.004) j += 1;
    }
    return transfers;
  }
}
