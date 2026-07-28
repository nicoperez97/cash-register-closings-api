import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingExpense } from '../../entities/closing-expense.entity';
import { ClosingExtraLine } from '../../entities/closing-extra-line.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { ShopsModule } from '../shops/shops.module';
import { ClosingsController } from './closings.controller';
import { ClosingsService } from './closings.service';
import { WhatsappImportService } from './whatsapp-import.service';
import { ExcelImportService } from './excel-import.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CashClosing,
      ClosingExpense,
      ClosingExtraLine,
      User,
      UserShop,
    ]),
    ShopsModule,
  ],
  controllers: [ClosingsController],
  providers: [ClosingsService, WhatsappImportService, ExcelImportService],
  exports: [ClosingsService],
})
export class ClosingsModule {}
