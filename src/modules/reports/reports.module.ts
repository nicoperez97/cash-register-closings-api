import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { Movement } from '../../entities/movement.entity';
import { AttendanceDay } from '../../entities/attendance-day.entity';
import { PayrollPeriod } from '../../entities/payroll-period.entity';
import { ShopsModule } from '../shops/shops.module';
import { MovementsModule } from '../movements/movements.module';
import { PayrollModule } from '../payroll/payroll.module';
import { SalesReportsModule } from '../sales-reports/sales-reports.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { TipsModule } from '../tips/tips.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { UserActivityService } from './user-activity.service';
import { ClosingSourceAmount } from '../../entities/closing-source-amount.entity';
import { CashPendingWithdrawal } from '../../entities/cash-pending-withdrawal.entity';
import { Payment } from '../../entities/payment.entity';
import { TipDay } from '../../entities/tip-day.entity';
import { TipAllocation } from '../../entities/tip-allocation.entity';
import { Reimbursement } from '../../entities/reimbursement.entity';
import { Order } from '../../entities/order.entity';
import { PosSaleImport } from '../../entities/pos-sale-import.entity';
import { PartnerSplitRun } from '../../entities/partner-split-run.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CashClosing,
      Movement,
      AttendanceDay,
      PayrollPeriod,
      ClosingSourceAmount,
      CashPendingWithdrawal,
      Payment,
      TipDay,
      TipAllocation,
      Reimbursement,
      Order,
      PosSaleImport,
      PartnerSplitRun,
      User,
      UserShop,
    ]),
    ShopsModule,
    MovementsModule,
    PayrollModule,
    SalesReportsModule,
    ReservationsModule,
    TipsModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService, UserActivityService],
})
export class ReportsModule {}
