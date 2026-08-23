import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PartnerSplitConfig } from '../../entities/partner-split-config.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Movement } from '../../entities/movement.entity';
import { AuthUser } from '../../common/decorators';
import { LedgerAccountType } from '../../common/enums';
import { ShopsService } from '../shops/shops.service';
import { MovementsService } from '../movements/movements.service';

const n = (v?: string | number | null) => Number(v ?? 0);
const money = (v: number) => (Math.round(Number(v || 0) * 100) / 100).toFixed(2);
const round2 = (v: number) => Math.round(Number(v || 0) * 100) / 100;
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
};

@Injectable()
export class PartnerSplitsService {
  constructor(
    @InjectRepository(PartnerSplitConfig)
    private readonly configs: Repository<PartnerSplitConfig>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(Movement) private readonly movementsRepo: Repository<Movement>,
    private readonly shops: ShopsService,
    private readonly movements: MovementsService,
  ) {}

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
    const created: string[] = [];
    for (const t of transfers) {
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
      created.push(row.id);
    }
    await this.saveConfig(user, shopId, preview.config);
    const after = await this.buildPreview(user, shopId, preview.config);
    return { createdCount: created.length, createdIds: created, ...after };
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
    const balances = await this.movements.balances(user, shopId);
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

    const partners = includedPartners.map((a) => {
      const current = round2(n(byId.get(a.id)?.balance));
      return { accountId: a.id, name: a.name, current };
    });
    const channels = channelAccs.map((a) => {
      const current = round2(n(byId.get(a.id)?.balance));
      const leaveAmount =
        config.channelLeaves.find((c) => c.accountId === a.id)?.leaveAmount ?? 0;
      return { accountId: a.id, name: a.name, current, leaveAmount };
    });

    const extrasTotal = round2(config.extras.reduce((s, e) => s + n(e.amount), 0));
    const balancesTotal = round2(
      partners.reduce((s, p) => s + p.current, 0) +
        channels.reduce((s, c) => s + c.current, 0),
    );
    const reserves = round2(channels.reduce((s, c) => s + c.leaveAmount, 0));
    const toDistribute = round2(balancesTotal - reserves - extrasTotal);
    const count = partners.length;
    const shareBase = count ? round2(toDistribute / count) : 0;
    const shareLast = count ? round2(toDistribute - shareBase * (count - 1)) : 0;

    const partnerRows = partners.map((p, i) => {
      const target = i === count - 1 ? shareLast : shareBase;
      return {
        ...p,
        included: true,
        target,
        share: target,
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
