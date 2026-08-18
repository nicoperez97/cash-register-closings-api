import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShopService } from '../../entities/shop-service.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { ShopsModule } from '../shops/shops.module';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

@Module({
  imports: [TypeOrmModule.forFeature([ShopService, LedgerAccount]), ShopsModule],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
