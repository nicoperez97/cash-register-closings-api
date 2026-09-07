import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { PartnerSplitsService } from './partner-splits.service';

class ChannelLeaveDto {
  @ApiProperty()
  @IsString()
  accountId: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  leaveAmount: number;
}

class ExtraLineDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  label: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  amount: number;
}

class PartnerGenerateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toAccountId?: string;

  @ApiProperty({ enum: ['skip', 'payment', 'movement'] })
  @IsIn(['skip', 'payment', 'movement'])
  generate: 'skip' | 'payment' | 'movement';
}

class PartnerCompleteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toAccountId?: string;

  @ApiProperty()
  @IsBoolean()
  complete: boolean;
}

class OwnershipItemDto {
  @ApiProperty()
  @IsString()
  accountId: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  ownershipPercent: number;
}

class OwnershipBatchDto {
  @ApiProperty({ type: [OwnershipItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OwnershipItemDto)
  items: OwnershipItemDto[];
}

class EqualizeDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  partnerAccountIds?: string[];

  @ApiPropertyOptional({
    description: 'Por cada pase: pago, movimiento o no hacer nada',
    type: [PartnerGenerateDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartnerGenerateDto)
  transferActions?: PartnerGenerateDto[];

  @ApiPropertyOptional({
    description:
      'Si true y hay sobrante sin socio que reciba, envía el exceso de cada socio a Dividendos.',
  })
  @IsOptional()
  @IsBoolean()
  sendSurplusToDividends?: boolean;

  @ApiPropertyOptional({
    description:
      'Si true y los saldos ya coinciden con el objetivo, envía el saldo de cada socio a Dividendos (sale del pool del local).',
  })
  @IsOptional()
  @IsBoolean()
  sendBalancedToDividends?: boolean;
}

class PartnerSplitConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  partnerAccountIds?: string[];

  @ApiPropertyOptional({ type: [ChannelLeaveDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChannelLeaveDto)
  channelLeaves?: ChannelLeaveDto[];

  @ApiPropertyOptional({ type: [ExtraLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraLineDto)
  extras?: ExtraLineDto[];

  @ApiPropertyOptional({ type: [PartnerGenerateDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartnerGenerateDto)
  partnerActions?: PartnerGenerateDto[];

  @ApiPropertyOptional({ type: [PartnerCompleteDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartnerCompleteDto)
  partnerComplete?: PartnerCompleteDto[];
}

@ApiTags('partner-splits')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/partner-splits')
export class PartnerSplitsController {
  constructor(private readonly splits: PartnerSplitsService) {}

  @Get()
  @RequirePermissions('partnerSplits.read')
  get(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
  ) {
    return this.splits.getPreview(user, shopId);
  }

  @Post('preview')
  @RequirePermissions('partnerSplits.read')
  preview(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() body: PartnerSplitConfigDto,
  ) {
    return this.splits.getPreview(user, shopId, body);
  }

  @Put('config')
  @RequirePermissions('partnerSplits.manage')
  save(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() body: PartnerSplitConfigDto,
  ) {
    return this.splits.saveConfig(user, shopId, {
      partnerAccountIds: body.partnerAccountIds ?? [],
      channelLeaves: body.channelLeaves ?? [],
      extras: body.extras ?? [],
    });
  }

  @Post('apply')
  @RequirePermissions('partnerSplits.manage')
  apply(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() body: PartnerSplitConfigDto,
  ) {
    return this.splits.apply(user, shopId, {
      partnerAccountIds: body.partnerAccountIds ?? [],
      channelLeaves: body.channelLeaves ?? [],
      extras: body.extras ?? [],
      partnerActions: body.partnerActions,
      partnerComplete: body.partnerComplete,
    });
  }

  @Put('ownership')
  @RequirePermissions('partnerSplits.manage')
  saveOwnership(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() body: OwnershipBatchDto,
  ) {
    return this.splits.saveOwnership(user, shopId, body.items ?? []);
  }

  @Post('equalize/preview')
  @RequirePermissions('partnerSplits.read')
  equalizePreview(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() body: EqualizeDto,
  ) {
    return this.splits.equalizePreview(user, shopId, body);
  }

  @Post('equalize/apply')
  @RequirePermissions('partnerSplits.manage')
  equalizeApply(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() body: EqualizeDto,
  ) {
    return this.splits.equalizeApply(user, shopId, body);
  }

  @Get('runs')
  @RequirePermissions('partnerSplits.read')
  listRuns(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.splits.listRuns(user, shopId);
  }

  @Get('runs/:id')
  @RequirePermissions('partnerSplits.read')
  getRun(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.splits.getRun(user, shopId, id);
  }
}
