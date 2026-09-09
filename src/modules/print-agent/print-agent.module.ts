import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrintJob } from '../../entities/print-job.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopLiveModule } from '../shop-live/shop-live.module';
import { ShopsModule } from '../shops/shops.module';
import {
  PrintAgentController,
  ShopPrintAgentController,
} from './print-agent.controller';
import { PrintAgentService } from './print-agent.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PrintJob, Shop]),
    ShopsModule,
    ShopLiveModule,
  ],
  controllers: [PrintAgentController, ShopPrintAgentController],
  providers: [PrintAgentService],
  exports: [PrintAgentService],
})
export class PrintAgentModule {}
