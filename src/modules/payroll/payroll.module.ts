import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayrollPeriod } from '../../entities/payroll-period.entity';
import { PayrollLine } from '../../entities/payroll-line.entity';
import { Employee } from '../../entities/employee.entity';
import { AttendanceModule } from '../attendance/attendance.module';
import { ShopsModule } from '../shops/shops.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PayrollPeriod, PayrollLine, Employee]),
    ShopsModule,
    AttendanceModule,
  ],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
