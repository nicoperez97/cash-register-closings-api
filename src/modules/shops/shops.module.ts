import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shop } from '../../entities/shop.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerAccountUser } from '../../entities/ledger-account-user.entity';
import { Concept } from '../../entities/concept.entity';
import { CatalogSeedService } from '../../common/catalog-seed.service';
import { ShopsController, PublicShopsController } from './shops.controller';
import { ShopsService } from './shops.service';
import { ShopBackupService } from './shop-backup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Shop,
      UserShop,
      User,
      LedgerAccount,
      LedgerAccountUser,
      Concept,
    ]),
  ],
  controllers: [ShopsController, PublicShopsController],
  providers: [ShopsService, ShopBackupService, CatalogSeedService],
  exports: [ShopsService, ShopBackupService],
})
export class ShopsModule {}
