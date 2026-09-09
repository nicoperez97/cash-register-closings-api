import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalonAreaRule } from '../../entities/salon-area-rule.entity';
import { SalonSector } from '../../entities/salon-sector.entity';
import { SalonTable } from '../../entities/salon-table.entity';
import { Reservation } from '../../entities/reservation.entity';
import { ShopsModule } from '../shops/shops.module';
import { SalonFloorController } from './salon-floor.controller';
import { SalonFloorService } from './salon-floor.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SalonTable, SalonSector, SalonAreaRule, Reservation]),
    ShopsModule,
  ],
  controllers: [SalonFloorController],
  providers: [SalonFloorService],
})
export class SalonFloorModule {}
