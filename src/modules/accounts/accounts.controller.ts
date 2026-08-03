import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsEnum, IsArray, IsOptional, IsString, IsUUID, MinLength, ValidateIf } from 'class-validator';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
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
}

@ApiTags('accounts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermissions('movements.read')
  list(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.accounts.list(user, shopId);
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

  @Delete(':id')
  @RequirePermissions('accounts.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.accounts.remove(user, shopId, id);
  }
}
