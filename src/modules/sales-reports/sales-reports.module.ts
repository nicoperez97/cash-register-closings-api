import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PosSaleImport } from '../../entities/pos-sale-import.entity';
import { PosSaleTicket } from '../../entities/pos-sale-ticket.entity';
import { PosSaleTicketLine } from '../../entities/pos-sale-ticket-line.entity';
import { PosSaleDaily } from '../../entities/pos-sale-daily.entity';
import { PosProduct } from '../../entities/pos-product.entity';
import { PosCategory } from '../../entities/pos-category.entity';
import { PosSubcategory } from '../../entities/pos-subcategory.entity';
import { Shop } from '../../entities/shop.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { CustomerOrder } from '../../entities/customer-order.entity';
import { SalesSystem } from '../../entities/sales-system.entity';
import { ShopsModule } from '../shops/shops.module';
import { SalesSystemsModule } from '../sales-systems/sales-systems.module';
import { SalesReportImportService } from './sales-report-import.service';
import { SalesProductsAnalyticsService } from './sales-products-analytics.service';
import { MenuSalesAnalyticsService } from './menu-sales-analytics.service';
import { PosCatalogService } from './pos-catalog.service';
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
      PosCategory,
      PosSubcategory,
      Shop,
      UserShop,
      CustomerOrder,
    ]),
    ShopsModule,
    SalesSystemsModule,
  ],
  controllers: [SalesReportsController],
  providers: [
    SalesReportImportService,
    SalesProductsAnalyticsService,
    MenuSalesAnalyticsService,
    PosCatalogService,
  ],
  exports: [
    SalesReportImportService,
    SalesProductsAnalyticsService,
    MenuSalesAnalyticsService,
    PosCatalogService,
  ],
})
export class SalesReportsModule {}
