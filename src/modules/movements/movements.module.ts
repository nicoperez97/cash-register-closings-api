import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Movement } from '../../entities/movement.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Concept } from '../../entities/concept.entity';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingExpense } from '../../entities/closing-expense.entity';
import { Employee } from '../../entities/employee.entity';
import { AccountsModule } from '../accounts/accounts.module';
import { ShopsModule } from '../shops/shops.module';
import { MovementsController } from './movements.controller';
import { MovementsService } from './movements.service';
import { ClosingMovementsSyncService } from './closing-movements-sync.service';
import { MovementsExcelImportService } from './movements-excel-import.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Movement,
      LedgerAccount,
      Concept,
      CashClosing,
      ClosingExpense,
      Employee,
    ]),
    ShopsModule,
    AccountsModule,
  ],
  controllers: [MovementsController],
  providers: [
    MovementsService,
    ClosingMovementsSyncService,
    MovementsExcelImportService,
  ],
  exports: [MovementsService, ClosingMovementsSyncService],
})
export class MovementsModule {}
