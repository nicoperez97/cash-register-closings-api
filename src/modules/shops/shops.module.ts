import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shop } from '../../entities/shop.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';
import { ShopBackupService } from './shop-backup.service';

@Module({
  imports: [TypeOrmModule.forFeature([Shop, UserShop, User])],
  controllers: [ShopsController],
  providers: [ShopsService, ShopBackupService],
  exports: [ShopsService, ShopBackupService],
})
export class ShopsModule {}
