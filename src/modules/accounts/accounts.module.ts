import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Concept } from '../../entities/concept.entity';
import { Shop } from '../../entities/shop.entity';
import { User } from '../../entities/user.entity';
import { LedgerAccountUser } from '../../entities/ledger-account-user.entity';
import { CatalogSeedService } from '../../common/catalog-seed.service';
import { ShopsModule } from '../shops/shops.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([LedgerAccount, LedgerAccountUser, Concept, Shop, User]),
    ShopsModule,
  ],
  controllers: [AccountsController],
  providers: [AccountsService, CatalogSeedService],
  exports: [AccountsService, CatalogSeedService],
})
export class AccountsModule {}
