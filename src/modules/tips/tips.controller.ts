import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { TipsService } from './tips.service';

class TipAllocationDto {
  @ApiProperty()
  @IsUUID()
  employeeId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  delivered?: boolean;
}

class UpsertTipDayDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  cashAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  transferAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  ticketsAmount?: number;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Montos de recibos (reemplaza transferencia/tickets)',
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  receipts?: number[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  closingId?: string | null;

  @ApiPropertyOptional({ type: [TipAllocationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TipAllocationDto)
  allocations?: TipAllocationDto[];
}

class SetDeliveredDto {
  @ApiProperty()
  @IsBoolean()
  delivered: boolean;
}

@ApiTags('tips')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/tips')
export class TipsController {
  constructor(private readonly tips: TipsService) {}

  @Get('pending-count')
  @RequirePermissions('tips.read')
  pendingCount(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.tips.pendingCount(user, shopId);
  }

  @Get('summary')
  @RequirePermissions('tips.read')
  summary(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.tips.summary(user, shopId, from, to);
  }

  @Get()
  @RequirePermissions('tips.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.tips.list(user, shopId, from, to);
  }

  @Get(':date')
  @RequirePermissions('tips.read')
  getOne(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('date') date: string,
  ) {
    return this.tips.getByDate(user, shopId, date);
  }

  @Put(':date')
  @RequirePermissions('tips.create')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('date') date: string,
    @Body() dto: UpsertTipDayDto,
  ) {
    return this.tips.upsert(user, shopId, date, dto);
  }

  @Patch(':date/allocations/:allocationId')
  @RequirePermissions('tips.create')
  setDelivered(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('date') date: string,
    @Param('allocationId') allocationId: string,
    @Body() dto: SetDeliveredDto,
  ) {
    return this.tips.setDelivered(user, shopId, date, allocationId, dto.delivered);
  }
}
