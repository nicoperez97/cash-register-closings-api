import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { VacationPersonType } from '../../entities/vacation.entity';
import { VacationsService } from './vacations.service';

class CreateVacationDto {
  @ApiProperty({ enum: VacationPersonType })
  @IsEnum(VacationPersonType)
  personType: VacationPersonType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  partnerAccountId?: string | null;

  @ApiProperty()
  @IsDateString()
  fromDate: string;

  @ApiProperty()
  @IsDateString()
  toDate: string;

  @ApiPropertyOptional({ default: true, description: 'Sin goce de sueldo' })
  @IsOptional()
  @IsBoolean()
  unpaid?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

class UpdateVacationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  partnerAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional({ description: 'Sin goce de sueldo' })
  @IsOptional()
  @IsBoolean()
  unpaid?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

@ApiTags('vacations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/vacations')
export class VacationsController {
  constructor(private readonly vacations: VacationsService) {}

  @Get('preview-days')
  @RequirePermissions('vacations.read')
  previewDays(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.vacations.previewDays(user, shopId, from, to);
  }

  @Get()
  @RequirePermissions('vacations.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('personType') personType?: VacationPersonType | '',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.vacations.list(user, shopId, { personType, from, to });
  }

  @Get(':id')
  @RequirePermissions('vacations.read')
  one(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.vacations.one(user, shopId, id);
  }

  @Post()
  @RequirePermissions('vacations.manage')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateVacationDto,
  ) {
    return this.vacations.create(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('vacations.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVacationDto,
  ) {
    return this.vacations.update(user, shopId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('vacations.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.vacations.remove(user, shopId, id);
  }
}
