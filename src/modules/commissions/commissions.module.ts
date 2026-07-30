import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployeeCommissionRule } from '../../entities/employee-commission-rule.entity';
import { Employee } from '../../entities/employee.entity';
import { PosSaleTicketLine } from '../../entities/pos-sale-ticket-line.entity';
import { ShopsModule } from '../shops/shops.module';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([EmployeeCommissionRule, Employee, PosSaleTicketLine]),
    ShopsModule,
  ],
  controllers: [CommissionsController],
  providers: [CommissionsService],
  exports: [CommissionsService],
})
export class CommissionsModule {}
