import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../../entities/payment.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { Supplier } from '../../entities/supplier.entity';
import { Employee } from '../../entities/employee.entity';
import { ShopsModule } from '../shops/shops.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MovementsModule } from '../movements/movements.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, LedgerAccount, User, UserShop, Supplier, Employee]),
    ShopsModule,
    NotificationsModule,
    MovementsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
