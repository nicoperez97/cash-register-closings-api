import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../../entities/employee.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { ShopsModule } from '../shops/shops.module';
import { PayrollModule } from '../payroll/payroll.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Employee, User, UserShop]),
    ShopsModule,
    forwardRef(() => PayrollModule),
  ],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
