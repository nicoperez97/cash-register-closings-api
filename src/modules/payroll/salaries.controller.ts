import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { Response } from 'express';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { SalariesService } from './salaries.service';

class UpdateSalaryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseSalary?: number;

  @ApiPropertyOptional({
    description: '0 = calcular desde sueldo diario ÷ horas del turno (entrada→retirada)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  overtimeHourRate?: number;

  @ApiPropertyOptional({
    description: 'null = hereda el del local; número > 0 = override',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  @Min(0.01)
  holidayPayMultiplier?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string | null;
}

@ApiTags('salaries')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/salaries')
export class SalariesController {
  constructor(private readonly salaries: SalariesService) {}

  @Get()
  @RequirePermissions('payroll.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const include = includeInactive === 'true';
    return this.salaries.list(user, shopId, include);
  }

  @Get('history')
  @RequirePermissions('payroll.read')
  history(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('employeeId') employeeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.salaries.history(user, shopId, { employeeId, from, to });
  }

  @Get('export.xlsx')
  @RequirePermissions('payroll.read')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('includeInactive') includeInactive: string | undefined,
    @Res() res: Response,
  ) {
    const include = includeInactive === 'true';
    const { buffer, filename } = await this.salaries.exportXlsx(user, shopId, include);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Patch(':employeeId')
  @RequirePermissions('payroll.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('employeeId') employeeId: string,
    @Body() dto: UpdateSalaryDto,
  ) {
    return this.salaries.update(user, shopId, employeeId, dto);
  }
}
