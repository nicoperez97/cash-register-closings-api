import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartnerSplitConfig } from '../../entities/partner-split-config.entity';
import { PartnerSplitRun } from '../../entities/partner-split-run.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Movement } from '../../entities/movement.entity';
import { Payment } from '../../entities/payment.entity';
import { ShopsModule } from '../shops/shops.module';
import { MovementsModule } from '../movements/movements.module';
import { PartnerSplitsController } from './partner-splits.controller';
import { PartnerSplitsService } from './partner-splits.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PartnerSplitConfig,
      PartnerSplitRun,
      LedgerAccount,
      Movement,
      Payment,
    ]),
    ShopsModule,
    MovementsModule,
  ],
  controllers: [PartnerSplitsController],
  providers: [PartnerSplitsService],
})
export class PartnerSplitsModule {}
