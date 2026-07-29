import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { Movement } from '../../entities/movement.entity';
import { AttendanceDay } from '../../entities/attendance-day.entity';
import { PayrollPeriod } from '../../entities/payroll-period.entity';
import { ShopsModule } from '../shops/shops.module';
import { MovementsModule } from '../movements/movements.module';
import { PayrollModule } from '../payroll/payroll.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CashClosing, Movement, AttendanceDay, PayrollPeriod]),
    ShopsModule,
    MovementsModule,
    PayrollModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
