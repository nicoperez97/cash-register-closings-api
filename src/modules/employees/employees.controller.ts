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
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CurrentUser, AuthUser, RequirePermissions, RequireAnyPermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { EmployeeType } from '../../entities/employee.entity';
import { EmployeesService } from './employees.service';

class CreateEmployeeDto {
  @ApiProperty() @IsString() @MinLength(2) fullName: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) baseSalary?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() hireDate?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional({ enum: EmployeeType })
  @IsOptional()
  @IsEnum(EmployeeType)
  type?: EmployeeType;
  @ApiPropertyOptional({ description: 'Si produce comida (asistencia en producción)' })
  @IsOptional()
  @IsBoolean()
  producesFood?: boolean;
  @ApiPropertyOptional({
    description: 'Productor supervisor a cargo (solo si produce comida)',
  })
  @IsOptional()
  @IsUUID()
  supervisorEmployeeId?: string | null;
  @ApiPropertyOptional({ description: 'Alias o CBU para transferencias / reintegros' })
  @IsOptional()
  @IsString()
  bankAlias?: string | null;
  @ApiPropertyOptional({ description: 'Precio por hora extra de servicio' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  overtimeHourRate?: number;
  @ApiPropertyOptional({ example: '18:00' })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  serviceCheckIn?: string | null;
  @ApiPropertyOptional({ example: '00:00' })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  serviceCheckOut?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateEmployeeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) baseSalary?: number;
  @ApiPropertyOptional() @IsOptional() userId?: string | null;
  @ApiPropertyOptional() @IsOptional() hireDate?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional({ enum: EmployeeType })
  @IsOptional()
  @IsEnum(EmployeeType)
  type?: EmployeeType;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  producesFood?: boolean;
  @ApiPropertyOptional({
    description: 'Productor supervisor a cargo (solo si produce comida)',
  })
  @IsOptional()
  supervisorEmployeeId?: string | null;
  @ApiPropertyOptional({ description: 'Alias o CBU para transferencias / reintegros' })
  @IsOptional()
  @IsString()
  bankAlias?: string | null;
  @ApiPropertyOptional({ description: 'Precio por hora extra de servicio' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  overtimeHourRate?: number;
  @ApiPropertyOptional({ example: '18:00' })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  serviceCheckIn?: string | null;
  @ApiPropertyOptional({ example: '00:00' })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  serviceCheckOut?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('employees')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequireAnyPermissions('employees.read', 'vacations.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.employees.list(user, shopId, includeInactive === 'true');
  }

  @Get(':id')
  @RequirePermissions('employees.read')
  one(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.employees.one(user, shopId, id);
  }

  @Post()
  @RequirePermissions('employees.manage')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateEmployeeDto,
  ) {
    return this.employees.create(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('employees.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(user, shopId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('employees.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.employees.remove(user, shopId, id);
  }
}
