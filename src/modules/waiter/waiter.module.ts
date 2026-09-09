import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerOrder } from '../../entities/customer-order.entity';
import { Employee } from '../../entities/employee.entity';
import { SalonSector } from '../../entities/salon-sector.entity';
import { SalonTable } from '../../entities/salon-table.entity';
import { Shop } from '../../entities/shop.entity';
import { TableSession } from '../../entities/table-session.entity';
import { AuthModule } from '../auth/auth.module';
import { CustomerOrdersModule } from '../customer-orders/customer-orders.module';
import { PrintAgentModule } from '../print-agent/print-agent.module';
import { ShopLiveModule } from '../shop-live/shop-live.module';
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
      TableSession,
      CustomerOrder,
    ]),
    AuthModule,
    CustomerOrdersModule,
    PrintAgentModule,
    ShopLiveModule,
  ],
  controllers: [WaiterController],
  providers: [WaiterService, WaiterAuthGuard],
})
export class WaiterModule {}
