import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerOrder } from '../../entities/customer-order.entity';
import { SalonMapObject } from '../../entities/salon-map-object.entity';
import { SalonSector } from '../../entities/salon-sector.entity';
import { SalonTable } from '../../entities/salon-table.entity';
import { Shop } from '../../entities/shop.entity';
import { TableSession } from '../../entities/table-session.entity';
import { AuthModule } from '../auth/auth.module';
import { CustomerOrdersModule } from '../customer-orders/customer-orders.module';
import { ShopLiveModule } from '../shop-live/shop-live.module';
import { DineInAuthGuard } from './dine-in-auth';
import { DineInController } from './dine-in.controller';
import { DineInService } from './dine-in.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Shop,
      SalonTable,
      SalonSector,
      SalonMapObject,
      TableSession,
      CustomerOrder,
    ]),
    AuthModule,
    CustomerOrdersModule,
    ShopLiveModule,
  ],
  controllers: [DineInController],
  providers: [DineInService, DineInAuthGuard],
})
export class DineInModule {}
