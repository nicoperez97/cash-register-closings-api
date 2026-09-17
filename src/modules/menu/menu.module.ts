import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shop } from '../../entities/shop.entity';
import { ShopsModule } from '../shops/shops.module';
import { MenuController, PublicMenuController } from './menu.controller';
import { PromosController } from './promos.controller';
import { MenuService } from './menu.service';

@Module({
  imports: [TypeOrmModule.forFeature([Shop]), ShopsModule],
  controllers: [MenuController, PublicMenuController, PromosController],
  providers: [MenuService],
})
export class MenuModule {}
