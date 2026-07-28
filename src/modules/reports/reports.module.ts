import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ShopsModule } from '../shops/shops.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [TypeOrmModule.forFeature([CashClosing]), ShopsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
