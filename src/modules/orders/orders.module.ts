import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../../entities/order.entity';
import { OrderLine } from '../../entities/order-line.entity';
import { StockProduct } from '../../entities/stock-product.entity';
import { Shortage } from '../../entities/shortage.entity';
import { ShopsModule } from '../shops/shops.module';
import { StockModule } from '../stock/stock.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderLine, StockProduct, Shortage]),
    ShopsModule,
    StockModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
