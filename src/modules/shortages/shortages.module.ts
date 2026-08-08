import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shortage } from '../../entities/shortage.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { ShopsModule } from '../shops/shops.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ShortagesController } from './shortages.controller';
import { ShortagesService } from './shortages.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Shortage, UserShop]),
    ShopsModule,
    NotificationsModule,
  ],
  controllers: [ShortagesController],
  providers: [ShortagesService],
  exports: [ShortagesService],
})
export class ShortagesModule {}
