import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingExpense } from '../../entities/closing-expense.entity';
import { ClosingExtraLine } from '../../entities/closing-extra-line.entity';
import { CashPendingWithdrawal } from '../../entities/cash-pending-withdrawal.entity';
import { ShopClosingSource } from '../../entities/shop-closing-source.entity';
import { ClosingSourceAmount } from '../../entities/closing-source-amount.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { Employee } from '../../entities/employee.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopsModule } from '../shops/shops.module';
import { MovementsModule } from '../movements/movements.module';
import { AccountsModule } from '../accounts/accounts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TipsModule } from '../tips/tips.module';
import { ClosingsController } from './closings.controller';
import { ClosingsService } from './closings.service';
import { ClosingSourcesController } from './closing-sources.controller';
import { ClosingSourcesService } from './closing-sources.service';
import { CashWithdrawalsController } from './cash-withdrawals.controller';
import { CashWithdrawalsService } from './cash-withdrawals.service';
import { WhatsappImportService } from './whatsapp-import.service';
import { ExcelImportService } from './excel-import.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CashClosing,
      ClosingExpense,
      ClosingExtraLine,
      CashPendingWithdrawal,
      ShopClosingSource,
      ClosingSourceAmount,
      LedgerAccount,
      User,
      UserShop,
      Employee,
      Shop,
    ]),
    ShopsModule,
    MovementsModule,
    AccountsModule,
    NotificationsModule,
    forwardRef(() => TipsModule),
  ],
  controllers: [ClosingsController, CashWithdrawalsController, ClosingSourcesController],
  providers: [
    ClosingsService,
    CashWithdrawalsService,
    ClosingSourcesService,
    WhatsappImportService,
    ExcelImportService,
  ],
  exports: [ClosingsService, CashWithdrawalsService, ClosingSourcesService],
})
export class ClosingsModule {}
