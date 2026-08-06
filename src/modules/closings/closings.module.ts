import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingExpense } from '../../entities/closing-expense.entity';
import { ClosingExtraLine } from '../../entities/closing-extra-line.entity';
import { CashPendingWithdrawal } from '../../entities/cash-pending-withdrawal.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { Employee } from '../../entities/employee.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopsModule } from '../shops/shops.module';
import { MovementsModule } from '../movements/movements.module';
import { AccountsModule } from '../accounts/accounts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClosingsController } from './closings.controller';
import { ClosingsService } from './closings.service';
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
      User,
      UserShop,
      Employee,
      Shop,
    ]),
    ShopsModule,
    MovementsModule,
    AccountsModule,
    NotificationsModule,
  ],
  controllers: [ClosingsController, CashWithdrawalsController],
  providers: [
    ClosingsService,
    CashWithdrawalsService,
    WhatsappImportService,
    ExcelImportService,
  ],
  exports: [ClosingsService, CashWithdrawalsService],
})
export class ClosingsModule {}
