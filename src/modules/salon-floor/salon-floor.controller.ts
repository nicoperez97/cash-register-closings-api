import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuthUser, CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { SalonArea } from '../../entities/salon-table.entity';
import { SalonFloorService } from './salon-floor.service';

class CreateSalonTableDto {
  @ApiPropertyOptional({ enum: SalonArea, default: SalonArea.INSIDE })
  @IsOptional()
  @IsEnum(SalonArea)
  area?: SalonArea;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  seats?: number;
}

class UpdateSalonTableDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  seats?: number;
}

class SalonRuleSlotDto {
  @ApiProperty({ example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(20)
  partySize: number;

  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  maxCount: number;
}

class ReplaceSalonRulesDto {
  @ApiProperty({ enum: SalonArea })
  @IsEnum(SalonArea)
  area: SalonArea;

  @ApiProperty({ type: [SalonRuleSlotDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalonRuleSlotDto)
  slots: SalonRuleSlotDto[];
}

@ApiTags('salon-floor')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/salon-floor')
export class SalonFloorController {
  constructor(private readonly salon: SalonFloorService) {}

  @Get()
  @RequirePermissions('reservations.read')
  getFloor(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.salon.getFloor(user, shopId);
  }

  @Post('tables')
  @RequirePermissions('reservations.manage')
  createTable(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateSalonTableDto,
  ) {
    return this.salon.createTable(user, shopId, dto);
  }

  @Patch('tables/:id')
  @RequirePermissions('reservations.manage')
  updateTable(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSalonTableDto,
  ) {
    return this.salon.updateTable(user, shopId, id, dto);
  }

  @Delete('tables/:id')
  @RequirePermissions('reservations.manage')
  removeTable(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.salon.removeTable(user, shopId, id);
  }

  @Put('rules')
  @RequirePermissions('reservations.manage')
  replaceRules(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: ReplaceSalonRulesDto,
  ) {
    return this.salon.replaceRules(user, shopId, dto);
  }
}
