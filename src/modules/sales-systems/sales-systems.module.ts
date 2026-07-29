import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesSystem } from '../../entities/sales-system.entity';
import { Shop } from '../../entities/shop.entity';
import { SalesSystemsSeedService } from '../../common/sales-systems-seed.service';
import { SalesParserRegistry } from '../sales-reports/parsers/parser-registry';
import { SalesSystemsController } from './sales-systems.controller';
import { SalesSystemsService } from './sales-systems.service';

@Module({
  imports: [TypeOrmModule.forFeature([SalesSystem, Shop])],
  controllers: [SalesSystemsController],
  providers: [SalesSystemsService, SalesSystemsSeedService, SalesParserRegistry],
  exports: [SalesSystemsService, SalesSystemsSeedService, SalesParserRegistry],
})
export class SalesSystemsModule {}
