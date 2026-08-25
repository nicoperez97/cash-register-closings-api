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
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CurrentUser, AuthUser, RequireAnyPermissions, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { LedgerAccountType, LinkedPaymentMethod } from '../../common/enums';
import { AccountsService } from './accounts.service';

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
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional({
    description: 'Si es true, no aparece en “Quién se lo lleva” del cierre',
  })
  @IsOptional()
  @IsBoolean()
  hideFromCashWithdraw?: boolean;
  @ApiPropertyOptional({ description: 'Si es false, no aparece al cargar un gasto' })
  @IsOptional()
  @IsBoolean()
  listInExpenses?: boolean;
  @ApiPropertyOptional({ description: 'Si es false, no aparece al cargar un ingreso' })
  @IsOptional()
  @IsBoolean()
  listInIncomes?: boolean;
  @ApiPropertyOptional({ description: 'Si es false, no aparece en movimientos entre cuentas' })
  @IsOptional()
  @IsBoolean()
  listInTransfers?: boolean;
  @ApiPropertyOptional({ description: 'Saldo inicial. Se suma al saldo de movimientos.' })
  @IsOptional()
  openingBalance?: number;
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
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hideFromCashWithdraw?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  listInExpenses?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  listInIncomes?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  listInTransfers?: boolean;
  @ApiPropertyOptional({ description: 'Saldo inicial. Se suma al saldo de movimientos.' })
  @IsOptional()
  openingBalance?: number;
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
    'movements.read',
    'accounts.manage',
    'closings.read',
    'closings.create',
    'payments.read',
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