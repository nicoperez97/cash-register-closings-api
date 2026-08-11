import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reservation } from '../../entities/reservation.entity';
import { ReservationDayNotice } from '../../entities/reservation-day-notice.entity';
import { ReservationRequest } from '../../entities/reservation-request.entity';
import { WaitingListEntry } from '../../entities/waiting-list-entry.entity';
import { Shop } from '../../entities/shop.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { ShopsModule } from '../shops/shops.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  PublicReservationsController,
  ReservationsController,
} from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationRequestsService } from './reservation-requests.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Reservation,
      ReservationDayNotice,
      ReservationRequest,
      WaitingListEntry,
      Shop,
      UserShop,
    ]),
    ShopsModule,
    NotificationsModule,
  ],
  controllers: [ReservationsController, PublicReservationsController],
  providers: [ReservationsService, ReservationRequestsService],
  exports: [ReservationsService, ReservationRequestsService],
})
export class ReservationsModule {}
