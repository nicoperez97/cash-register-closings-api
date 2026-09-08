import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerOrder } from '../../entities/customer-order.entity';
import { Shop } from '../../entities/shop.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { ShopLiveModule } from '../shop-live/shop-live.module';
import { ShopsModule } from '../shops/shops.module';
import {
  CustomerOrdersController,
  PublicCustomerOrdersController,
} from './customer-orders.controller';
import { CustomerOrdersService } from './customer-orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerOrder, Shop, UserShop, User]),
    ShopsModule,
    ShopLiveModule,
    NotificationsModule,
  ],
  controllers: [PublicCustomerOrdersController, CustomerOrdersController],
  providers: [CustomerOrdersService],
  exports: [CustomerOrdersService],
})
export class CustomerOrdersModule {}
