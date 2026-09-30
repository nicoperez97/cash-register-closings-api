import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { Shop } from '../../entities/shop.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingExpense } from '../../entities/closing-expense.entity';
import { ClosingExtraLine } from '../../entities/closing-extra-line.entity';
import { LedgerAccountUser } from '../../entities/ledger-account-user.entity';
import { ShopClosingSource } from '../../entities/shop-closing-source.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import { Concept } from '../../entities/concept.entity';
import { CatalogSeedService } from '../../common/catalog-seed.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('api.secret'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
    TypeOrmModule.forFeature([
      User,
      Shop,
      UserShop,
      CashClosing,
      ClosingExpense,
      ClosingExtraLine,
      LedgerAccountUser,
      ShopClosingSource,
      LedgerAccount,
      Concept,
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, CatalogSeedService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
