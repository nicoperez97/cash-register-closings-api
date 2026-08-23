import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
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
    return this.splits.apply(user, shopId, body);
  }
}
