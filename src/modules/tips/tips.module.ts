import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TipDay } from '../../entities/tip-day.entity';
import { TipAllocation } from '../../entities/tip-allocation.entity';
import { Employee } from '../../entities/employee.entity';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ShopsModule } from '../shops/shops.module';
import { TipsController } from './tips.controller';
import { TipsService } from './tips.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TipDay, TipAllocation, Employee, CashClosing]),
    forwardRef(() => ShopsModule),
  ],
  controllers: [TipsController],
  providers: [TipsService],
  exports: [TipsService],
})
export class TipsModule {}
