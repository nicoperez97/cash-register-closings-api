import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerOrder } from '../../entities/customer-order.entity';
import { ShopIntegration } from '../../entities/shop-integration.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopLiveModule } from '../shop-live/shop-live.module';
import { DeliverateClient } from './deliverate.client';
import {
  CustomerOrderDeliverateController,
  DeliverateIntegrationsController,
  IntegrationsWebhookController,
} from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ShopIntegration, CustomerOrder, Shop]),
    ShopLiveModule,
  ],
  controllers: [
    IntegrationsWebhookController,
    DeliverateIntegrationsController,
    CustomerOrderDeliverateController,
  ],
  providers: [DeliverateClient, IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
