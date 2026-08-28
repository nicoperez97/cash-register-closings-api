import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vacation } from '../../entities/vacation.entity';
import { Employee } from '../../entities/employee.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopsModule } from '../shops/shops.module';
import { VacationsController } from './vacations.controller';
import { VacationsService } from './vacations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Vacation, Employee, LedgerAccount, Shop]),
    ShopsModule,
  ],
  controllers: [VacationsController],
  providers: [VacationsService],
  exports: [VacationsService],
})
export class VacationsModule {}
