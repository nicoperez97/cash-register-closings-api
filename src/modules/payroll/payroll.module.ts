import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayrollPeriod } from '../../entities/payroll-period.entity';
import { PayrollLine } from '../../entities/payroll-line.entity';
import { Employee } from '../../entities/employee.entity';
import { EmployeeSalaryHistory } from '../../entities/employee-salary-history.entity';
import { Shop } from '../../entities/shop.entity';
import { AttendanceModule } from '../attendance/attendance.module';
import { ShopsModule } from '../shops/shops.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { SalariesController } from './salaries.controller';
import { SalariesService } from './salaries.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PayrollPeriod,
      PayrollLine,
      Employee,
      EmployeeSalaryHistory,
      Shop,
    ]),
    ShopsModule,
    AttendanceModule,
  ],
  controllers: [PayrollController, SalariesController],
  providers: [PayrollService, SalariesService],
  exports: [PayrollService, SalariesService],
})
export class PayrollModule {}
