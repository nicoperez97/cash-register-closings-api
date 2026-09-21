import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerOrder } from '../../entities/customer-order.entity';
import { Shop } from '../../entities/shop.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { TableSession } from '../../entities/table-session.entity';
import { Reservation } from '../../entities/reservation.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrintAgentModule } from '../print-agent/print-agent.module';
import { ShopLiveModule } from '../shop-live/shop-live.module';
import { ShopsModule } from '../shops/shops.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ClosingsModule } from '../closings/closings.module';
import { StockModule } from '../stock/stock.module';
import {
  CustomerOrdersController,
  PublicCustomerOrdersController,
} from './customer-orders.controller';
import { CustomerOrdersService } from './customer-orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomerOrder,
      Shop,
      UserShop,
      User,
      TableSession,
      Reservation,
    ]),
    ShopsModule,
    ShopLiveModule,
    NotificationsModule,
    PrintAgentModule,
    forwardRef(() => IntegrationsModule),
    forwardRef(() => ClosingsModule),
    StockModule,
  ],
  controllers: [PublicCustomerOrdersController, CustomerOrdersController],
  providers: [CustomerOrdersService],
  exports: [CustomerOrdersService],
})
export class CustomerOrdersModule {}
