import { Injectable, UnauthorizedException, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../entities/user.entity';
import { Shop } from '../../entities/shop.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingExpense } from '../../entities/closing-expense.entity';
import { ClosingExtraLine } from '../../entities/closing-extra-line.entity';
import { LedgerAccountUser } from '../../entities/ledger-account-user.entity';
import { LoginDto } from './dto/login.dto';
import {
  ClosingStatus,
  ExpenseCategory,
  ExtraLineType,
  GlobalRole,
} from '../../common/enums';
import { isGlobalAdmin, resolvePermissions } from '../../common/guards';
import { AuthUser } from '../../common/decorators';

const IDS = {
  panino: '11111111-1111-1111-1111-111111111111',
  tutto: '22222222-2222-2222-2222-222222222222',
  admin: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  manager: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  cashier: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
};

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    @InjectRepository(CashClosing) private readonly closings: Repository<CashClosing>,
    @InjectRepository(ClosingExpense) private readonly expenses: Repository<ClosingExpense>,
    @InjectRepository(ClosingExtraLine) private readonly extras: Repository<ClosingExtraLine>,
    @InjectRepository(LedgerAccountUser)
    private readonly accountLinks: Repository<LedgerAccountUser>,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureSeed();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[AuthService] Seed failed:', err);
    }
  }

  private async ensureSeed() {
    let panino = await this.shops.findOne({ where: { id: IDS.panino } });
    if (!panino) {
      panino = await this.shops.save(
        this.shops.create({
          id: IDS.panino,
          name: 'Al Panino',
          slug: 'al-panino',
          unitsLabel: 'paninos',
          coversEnabled: false,
          defaultChangeAmount: '15000.00',
          accentColor: '#E65100',
          active: true,
        }),
      );
    } else if (!panino.accentColor) {
      panino.accentColor = '#E65100';
      await this.shops.save(panino);
    }

    let tutto = await this.shops.findOne({ where: { id: IDS.tutto } });
    if (!tutto) {
      tutto = await this.shops.save(
        this.shops.create({
          id: IDS.tutto,
          name: 'Tutto Passa',
          slug: 'tutto-passa',
          unitsLabel: null,
          coversEnabled: true,
          defaultChangeAmount: '0.00',
          accentColor: '#00897B',
          active: true,
        }),
      );
    } else if (!tutto.accentColor) {
      tutto.accentColor = '#00897B';
      await this.shops.save(tutto);
    }

    const passwordHash = await bcrypt.hash('demo', 10);
    const seedUsers: Array<Partial<User> & { shopIds: string[] }> = [
      {
        id: IDS.admin,
        fullName: 'Admin Cierres',
        email: 'admin@cierres.com',
        passwordHash,
        globalRole: GlobalRole.ADMIN,
        shopIds: [IDS.panino, IDS.tutto],
      },
      {
        id: IDS.manager,
        fullName: 'Manager Multi',
        email: 'manager@cierres.com',
        passwordHash,
        globalRole: GlobalRole.MANAGER,
        shopIds: [IDS.panino, IDS.tutto],
      },
      {
        id: IDS.cashier,
        fullName: 'Cajero Panino',
        email: 'cashier@cierres.com',
        passwordHash,
        globalRole: GlobalRole.CASHIER,
        shopIds: [IDS.panino],
      },
    ];

    for (const su of seedUsers) {
      const existing = await this.users.findOne({ where: { email: su.email } });
      if (existing) continue;
      const { shopIds, ...userData } = su;
      const user = await this.users.save(this.users.create({ ...userData, active: true }));
      for (const shopId of shopIds) {
        const shopRole =
          userData.globalRole === GlobalRole.ADMIN ||
          userData.globalRole === GlobalRole.OWNER ||
          userData.globalRole === GlobalRole.MANAGER
            ? GlobalRole.ADMIN
            : (userData.globalRole as GlobalRole);
        await this.userShops.save(
          this.userShops.create({ userId: user.id, shopId, shopRole }),
        );
      }
    }

    await this.ensureSampleClosings();
  }

  private async ensureSampleClosings() {
    const count = await this.closings.count();
    if (count > 0) return;

    const samples: Array<{
      data: Partial<CashClosing>;
      expenses?: Array<{ label: string; amount: string; category: ExpenseCategory }>;
      extras?: Array<{ type: ExtraLineType; label: string; amount: string; meta?: string }>;
    }> = [
      {
        data: {
          id: 'd1111111-1111-1111-1111-111111111114',
          shopId: IDS.panino,
          businessDate: '2026-05-14',
          posSystemAmount: '721975.00',
          cardAmount: '473475.00',
          cashAmount: '248500.00',
          declaredTotal: '721975.00',
          calculatedTotal: '721975.00',
          difference: '0.00',
          unitsSold: 66,
          cashLeftInRegister: '28500.00',
          cashWithdrawn: '220000.00',
          cashWithdrawnByName: 'Facu Odo',
          notes: 'Lleva a luz azul (efectivo)',
          status: ClosingStatus.SUBMITTED,
          createdByUserId: IDS.cashier,
        },
      },
      {
        data: {
          id: 'd1111111-1111-1111-1111-111111111125',
          shopId: IDS.panino,
          businessDate: '2026-07-25',
          posSystemAmount: '479750.00',
          cardAmount: '306000.00',
          cashAmount: '100000.00',
          deliveryAppsAmount: '13800.00',
          transferAmount: '38000.00',
          declaredTotal: '457800.00',
          calculatedTotal: '457800.00',
          difference: '21950.00',
          unitsSold: 45,
          cashLeftInRegister: '15000.00',
          status: ClosingStatus.SUBMITTED,
          createdByUserId: IDS.cashier,
        },
      },
      {
        data: {
          id: 'd2222222-2222-2222-2222-222222222224',
          shopId: IDS.tutto,
          businessDate: '2026-07-24',
          posSystemAmount: '1366320.00',
          cardAmount: '854230.00',
          cashAmount: '340000.00',
          accountDniAmount: '178000.00',
          declaredTotal: '1372230.00',
          calculatedTotal: '1372230.00',
          difference: '-5910.00',
          tipsAmount: '20000.00',
          cashWithdrawn: '320000.00',
          cashWithdrawnByName: 'Santiago',
          notes: 'Propina 20mil falta Seba, Mati y Kevin. Queda en caja',
          status: ClosingStatus.SUBMITTED,
          createdByUserId: IDS.manager,
        },
        extras: [
          { type: ExtraLineType.PVS_BREAKDOWN, label: 'PVS terminal 1', amount: '162960.00' },
          { type: ExtraLineType.PVS_BREAKDOWN, label: 'PVS terminal 2', amount: '691270.00' },
          {
            type: ExtraLineType.TIP_ALLOCATION,
            label: 'Propina mozos',
            amount: '20000.00',
            meta: JSON.stringify({ employees: ['Seba', 'Mati', 'Kevin'], paid: false }),
          },
        ],
      },
      {
        data: {
          id: 'd1111111-1111-1111-1111-111111111121',
          shopId: IDS.panino,
          businessDate: '2026-05-21',
          posSystemAmount: '534675.00',
          cardAmount: '407950.00',
          cashAmount: '206900.00',
          declaredTotal: '614850.00',
          calculatedTotal: '614850.00',
          difference: '-80175.00',
          unitsSold: 56,
          cashWithdrawn: '170000.00',
          cashWithdrawnByName: 'Facu Odo',
          notes: 'Lleva a tutto para fonti 170mil',
          status: ClosingStatus.SUBMITTED,
          createdByUserId: IDS.cashier,
        },
        expenses: [
          { label: 'Mayonesa', amount: '5400.00', category: ExpenseCategory.SUPPLIES },
          { label: 'Wifi', amount: '34000.00', category: ExpenseCategory.SERVICES },
        ],
      },
    ];

    for (const s of samples) {
      const row = await this.closings.save(
        this.closings.create({
          ...s.data,
          mercadoPagoAmount: s.data.mercadoPagoAmount ?? '0.00',
          deliveryAppsAmount: s.data.deliveryAppsAmount ?? '0.00',
          transferAmount: s.data.transferAmount ?? '0.00',
          accountDniAmount: s.data.accountDniAmount ?? '0.00',
          otherAmount: '0.00',
          cashLeftInRegister: s.data.cashLeftInRegister ?? '0.00',
          cashPendingPickup: '0.00',
          cashWithdrawn: s.data.cashWithdrawn ?? '0.00',
          tipsAmount: s.data.tipsAmount ?? '0.00',
          submittedAt: new Date(),
          active: true,
        }),
      );
      if (s.expenses?.length) {
        await this.expenses.save(
          s.expenses.map((e) =>
            this.expenses.create({
              closingId: row.id,
              label: e.label,
              amount: e.amount,
              category: e.category,
            }),
          ),
        );
      }
      if (s.extras?.length) {
        await this.extras.save(
          s.extras.map((e) =>
            this.extras.create({
              closingId: row.id,
              type: e.type,
              label: e.label,
              amount: e.amount,
              meta: e.meta ?? null,
            }),
          ),
        );
      }
    }
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOne({
      where: { email: dto.email.toLowerCase().trim() },
      select: ['id', 'email', 'fullName', 'globalRole', 'passwordHash', 'active'],
    });
    if (!user?.active) throw new UnauthorizedException('Credenciales inválidas');
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Credenciales inválidas');

    const profile = await this.buildAuthUser(user.id);
    const accessToken = await this.jwt.signAsync({
      sub: profile.id,
      email: profile.email,
      role: profile.globalRole,
    });
    return { accessToken, user: profile };
  }

  async buildAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user?.active) throw new UnauthorizedException();
    const role = user.globalRole;
    const links = await this.userShops.find({ where: { userId } });
    let shopIds: string[];
    if (isGlobalAdmin(role)) {
      const all = await this.shops.find({ where: { active: true } });
      shopIds = all.map((s) => s.id);
    } else {
      shopIds = links.map((l) => l.shopId);
    }
    const shopRoles: Record<string, string> = {};
    for (const id of shopIds) {
      const link = links.find((l) => l.shopId === id);
      shopRoles[id] = link?.shopRole ?? role;
    }
    const linked = shopIds.length
      ? await this.accountLinks.find({
          where: { userId, shopId: In(shopIds) },
        })
      : [];
    const shopAccountIds: Record<string, string[]> = {};
    for (const l of linked) {
      const arr = shopAccountIds[l.shopId] ?? [];
      arr.push(l.accountId);
      shopAccountIds[l.shopId] = arr;
    }
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      globalRole: role,
      shopIds,
      shopRoles,
      shopAccountIds,
      permissions: resolvePermissions(role),
    };
  }

  async me(userId: string) {
    const profile = await this.buildAuthUser(userId);
    const shops =
      profile.shopIds.length > 0
        ? await this.shops.find({ where: { id: In(profile.shopIds), active: true } })
        : [];
    return {
      ...profile,
      shops: shops.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        unitsLabel: s.unitsLabel,
        coversEnabled: !!s.coversEnabled,
        defaultChangeAmount: Number(s.defaultChangeAmount),
        currency: s.currency,
        logoUrl: s.logoUrl ?? null,
        accentColor: s.accentColor ?? null,
        salesSystemId: s.salesSystemId ?? null,
      })),
    };
  }
}
