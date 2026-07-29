import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PosSaleImport } from '../../entities/pos-sale-import.entity';
import { PosSaleTicket } from '../../entities/pos-sale-ticket.entity';
import { PosSaleTicketLine } from '../../entities/pos-sale-ticket-line.entity';
import { PosSaleDaily } from '../../entities/pos-sale-daily.entity';
import { PosProduct } from '../../entities/pos-product.entity';
import { CashClosing } from '../../entities/cash-closing.entity';
import { Shop } from '../../entities/shop.entity';
import { SalesSystem } from '../../entities/sales-system.entity';
import { ShopsModule } from '../shops/shops.module';
import { SalesSystemsModule } from '../sales-systems/sales-systems.module';
import { SalesReportImportService } from './sales-report-import.service';
import { SalesProductsAnalyticsService } from './sales-products-analytics.service';
import { SalesReportsController } from './sales-reports.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesSystem,
      PosSaleImport,
      PosSaleTicket,
      PosSaleTicketLine,
      PosSaleDaily,
      PosProduct,
      CashClosing,
      Shop,
    ]),
    ShopsModule,
    SalesSystemsModule,
  ],
  controllers: [SalesReportsController],
  providers: [SalesReportImportService, SalesProductsAnalyticsService],
  exports: [SalesReportImportService, SalesProductsAnalyticsService],
})
export class SalesReportsModule {}
