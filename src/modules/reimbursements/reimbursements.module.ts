import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reimbursement } from '../../entities/reimbursement.entity';
import { Employee } from '../../entities/employee.entity';
import { Shop } from '../../entities/shop.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { ShopsModule } from '../shops/shops.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReimbursementsController } from './reimbursements.controller';
import { ReimbursementsService } from './reimbursements.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reimbursement, Employee, Shop, User, UserShop]),
    ShopsModule,
    NotificationsModule,
  ],
  controllers: [ReimbursementsController],
  providers: [ReimbursementsService],
  exports: [ReimbursementsService],
})
export class ReimbursementsModule {}
