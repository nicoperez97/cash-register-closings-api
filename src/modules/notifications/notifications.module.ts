import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppNotification } from '../../entities/notification.entity';
import { PushSubscription } from '../../entities/push-subscription.entity';
import { User } from '../../entities/user.entity';
import { Shop } from '../../entities/shop.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PushService } from './push.service';
import { PushController } from './push.controller';
import { MailService } from './mail.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AppNotification, PushSubscription, User, Shop]),
  ],
  controllers: [NotificationsController, PushController],
  providers: [NotificationsService, PushService, MailService],
  exports: [NotificationsService, PushService, MailService],
})
export class NotificationsModule {}
