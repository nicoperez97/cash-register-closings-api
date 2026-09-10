import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerOrder } from '../../entities/customer-order.entity';
import { Employee } from '../../entities/employee.entity';
import { SalonMapObject } from '../../entities/salon-map-object.entity';
import { SalonSector } from '../../entities/salon-sector.entity';
import { SalonTable } from '../../entities/salon-table.entity';
import { Shop } from '../../entities/shop.entity';
import { TableSession } from '../../entities/table-session.entity';
import { AuthModule } from '../auth/auth.module';
import { CustomerOrdersModule } from '../customer-orders/customer-orders.module';
import { PrintAgentModule } from '../print-agent/print-agent.module';
import { ShopLiveModule } from '../shop-live/shop-live.module';
import { ShopsModule } from '../shops/shops.module';
import { StaffComandaController } from './staff-comanda.controller';
import { WaiterAuthGuard } from './waiter-auth';
import { WaiterController } from './waiter.controller';
import { WaiterService } from './waiter.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Shop,
      Employee,
      SalonTable,
      SalonSector,
      SalonMapObject,
      TableSession,
      CustomerOrder,
    ]),
    AuthModule,
    ShopsModule,
    CustomerOrdersModule,
    PrintAgentModule,
    ShopLiveModule,
  ],
  controllers: [WaiterController, StaffComandaController],
  providers: [WaiterService, WaiterAuthGuard],
})
export class WaiterModule {}
