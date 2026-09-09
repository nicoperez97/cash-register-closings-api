import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { AuthUser, CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { SalonArea } from '../../entities/salon-table.entity';
import { SalonFloorService } from './salon-floor.service';

class CreateSalonSectorDto {
  @ApiProperty({ example: 'Terraza' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;
}

class UpdateSalonSectorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

class CreateSalonTableDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sectorId?: string;

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

class CreateSalonTablesBulkDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  from: number;

  @ApiProperty({ example: 30 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  to: number;

  @ApiProperty()
  @IsUUID()
  sectorId: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sectorId?: string;
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

class ApplyFromReservationsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  onlyIfEmpty?: boolean;
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

  @Post('sectors')
  @RequirePermissions('reservations.manage')
  createSector(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateSalonSectorDto,
  ) {
    return this.salon.createSector(user, shopId, dto);
  }

  @Patch('sectors/:id')
  @RequirePermissions('reservations.manage')
  updateSector(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSalonSectorDto,
  ) {
    return this.salon.updateSector(user, shopId, id, dto);
  }

  @Delete('sectors/:id')
  @RequirePermissions('reservations.manage')
  removeSector(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.salon.removeSector(user, shopId, id);
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

  @Post('tables/bulk')
  @RequirePermissions('reservations.manage')
  createTablesBulk(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateSalonTablesBulkDto,
  ) {
    return this.salon.createTablesBulk(user, shopId, dto);
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

  @Post('from-reservations')
  @RequirePermissions('reservations.manage')
  applyFromReservations(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() body: ApplyFromReservationsDto,
  ) {
    return this.salon.applyFromReservations(user, shopId, {
      onlyIfEmpty: !!body?.onlyIfEmpty,
    });
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
