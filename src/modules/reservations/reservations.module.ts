import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reservation } from '../../entities/reservation.entity';
import { WaitingListEntry } from '../../entities/waiting-list-entry.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopsModule } from '../shops/shops.module';
import {
  PublicReservationsController,
  ReservationsController,
} from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation, WaitingListEntry, Shop]),
    ShopsModule,
  ],
  controllers: [ReservationsController, PublicReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
