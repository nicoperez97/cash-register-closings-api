import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import {
  IsBoolean,
  IsEnum,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, AuthUser, RequireAnyPermissions, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { LedgerAccountType, LinkedPaymentMethod } from '../../common/enums';
import { AccountsService } from './accounts.service';
import { ToBoolean } from '../../common/boolean.util';

class CreateAccountDto {
  @ApiProperty() @IsString() @MinLength(1) name: string;
  @ApiProperty() @IsString() @MinLength(1) code: string;
  @ApiPropertyOptional({ enum: LedgerAccountType })
  @IsOptional()
  @IsEnum(LedgerAccountType)
  type?: LedgerAccountType;
  @ApiPropertyOptional({ enum: LinkedPaymentMethod })
  @IsOptional()
  @IsEnum(LinkedPaymentMethod)
  linkedPaymentMethod?: LinkedPaymentMethod | null;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  userIds?: string[];
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  userId?: string | null;
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() active?: boolean;
  @ApiPropertyOptional({
    description: 'Si es true, no aparece en “Quién se lo lleva” del cierre',
  })
  @IsOptional()
  @ToBoolean() @IsBoolean()
  hideFromCashWithdraw?: boolean;
  @ApiPropertyOptional({ description: 'Si es false, no aparece al cargar un gasto' })
  @IsOptional()
  @ToBoolean() @IsBoolean()
  listInExpenses?: boolean;
  @ApiPropertyOptional({ description: 'Si es false, no aparece al cargar un ingreso' })
  @IsOptional()
  @ToBoolean() @IsBoolean()
  listInIncomes?: boolean;
  @ApiPropertyOptional({ description: 'Si es false, no aparece en movimientos entre cuentas' })
  @IsOptional()
  @ToBoolean() @IsBoolean()
  listInTransfers?: boolean;
  @ApiPropertyOptional({ description: 'Si es false, no aparece en el panel de Saldos' })
  @IsOptional()
  @ToBoolean() @IsBoolean()
  listInBalances?: boolean;
  @ApiPropertyOptional({ description: 'Saldo inicial. Se suma al saldo de movimientos.' })
  @IsOptional()
  openingBalance?: number;
  @ApiPropertyOptional({ description: 'Comisión % (0 = sin comisión). En Saldos se muestra el neto.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPercent?: number;
  @ApiPropertyOptional({ description: '% de división del socio (solo PARTNER).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  ownershipPercent?: number;
}

class UpdateAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) code?: string;
  @ApiPropertyOptional({ enum: LedgerAccountType })
  @IsOptional()
  @IsEnum(LedgerAccountType)
  type?: LedgerAccountType;
  @ApiPropertyOptional({ enum: LinkedPaymentMethod })
  @IsOptional()
  @IsEnum(LinkedPaymentMethod)
  linkedPaymentMethod?: LinkedPaymentMethod | null;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  userIds?: string[];
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  userId?: string | null;
  @ApiPropertyOptional() @IsOptional() @ToBoolean() @IsBoolean() active?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean() @IsBoolean()
  hideFromCashWithdraw?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean() @IsBoolean()
  listInExpenses?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean() @IsBoolean()
  listInIncomes?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean() @IsBoolean()
  listInTransfers?: boolean;
  @ApiPropertyOptional({ description: 'Si es false, no aparece en el panel de Saldos' })
  @IsOptional()
  @ToBoolean() @IsBoolean()
  listInBalances?: boolean;
  @ApiPropertyOptional({ description: 'Saldo inicial. Se suma al saldo de movimientos.' })
  @IsOptional()
  openingBalance?: number;
  @ApiPropertyOptional({ description: 'Comisión % (0 = sin comisión). En Saldos se muestra el neto.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPercent?: number;
  @ApiPropertyOptional({ description: '% de división del socio (solo PARTNER).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  ownershipPercent?: number;
}

/** Mapa medio de cobro del cierre → id de cuenta (null = sin vincular). */
class PaymentDepositsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  cash?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  card?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  mercadoPago?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  delivery?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  transfer?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  accountDni?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  other?: string | null;
}

class PartnerDividendConfigDto {
  @ApiPropertyOptional({
    description: 'Cuenta destino de Equilibrar / Es dividendo. null = Dividendos.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  partnerDividendAccountId?: string | null;

  @ApiPropertyOptional({
    description: 'Concepto de división / dividendos. null = sin concepto.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  partnerDividendConceptId?: string | null;
}

@ApiTags('accounts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequireAnyPermissions(
    'expenses.read',
    'accountTransfers.read',
    'incomes.read',
    'movements.read',
    'accounts.manage',
    'closings.read',
    'closings.create',
    'payments.read',
    'vacations.read',
  )
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.accounts.list(user, shopId, {
      includeInactive: includeInactive === '1' || includeInactive === 'true',
    });
  }

  @Put('payment-deposits')
  @RequirePermissions('accounts.manage')
  setPaymentDeposits(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: PaymentDepositsDto,
  ) {
    return this.accounts.setPaymentDeposits(
      user,
      shopId,
      dto as Partial<Record<LinkedPaymentMethod, string | null>>,
    );
  }

  @Put('partner-dividend-config')
  @RequirePermissions('accounts.manage')
  setPartnerDividendConfig(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: PartnerDividendConfigDto,
  ) {
    return this.accounts.setPartnerDividendConfig(user, shopId, dto);
  }

  @Post()
  @RequirePermissions('accounts.manage')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateAccountDto,
  ) {
    return this.accounts.create(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('accounts.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accounts.update(user, shopId, id, dto);
  }

  @Get(':id/balance')
  @RequirePermissions('accounts.manage')
  balance(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.accounts.balanceOf(user, shopId, id);
  }

  @Delete(':id')
  @RequirePermissions('accounts.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Query('transferToAccountId') transferToAccountId?: string,
  ) {
    return this.accounts.remove(user, shopId, id, transferToAccountId);
  }
}