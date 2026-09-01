import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';
import { Response } from 'express';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { PayrollService } from './payroll.service';

class PayrollRangeDto {
  @ApiProperty({ example: '2026-08-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string;

  @ApiProperty({ example: '2026-08-31' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string;

  @ApiPropertyOptional({
    description: 'Monto del presentismo por semana completa (0 = desactivado)',
    example: 50000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  attendanceBonusAmount?: number;

  @ApiPropertyOptional({
    description: 'Si true, genera una línea por empleado y turno',
  })
  @IsOptional()
  @IsBoolean()
  splitByShift?: boolean;
}

@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('sac')
  @RequirePermissions('payroll.read')
  sac(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('year') year: string,
    @Query('semester') semester: string,
  ) {
    const sem = Number(semester) === 2 ? 2 : 1;
    return this.payroll.sac(
      user,
      shopId,
      Number(year) || new Date().getFullYear(),
      sem,
    );
  }

  @Get('export.xlsx')
  @RequirePermissions('payroll.read')
  async exportRange(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.payroll.exportPeriodXlsxByRange(
      user,
      shopId,
      from,
      to,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get()
  @RequirePermissions('payroll.read')
  getRange(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.payroll.getByRange(user, shopId, from, to);
  }

  @Post('generate')
  @RequirePermissions('payroll.manage')
  generateRange(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: PayrollRangeDto,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.payroll.generateByRange(
      user,
      shopId,
      dto.from,
      dto.to,
      includeInactive === 'true',
      {
        attendanceBonusAmount: dto.attendanceBonusAmount,
        splitByShift: dto.splitByShift,
      },
    );
  }

  /** Compat mes/año. */
  @Get(':year/:month/export.xlsx')
  @RequirePermissions('payroll.read')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.payroll.exportPeriodXlsx(
      user,
      shopId,
      Number(year),
      Number(month),
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get(':year/:month')
  @RequirePermissions('payroll.read')
  get(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.payroll.get(user, shopId, Number(year), Number(month));
  }

  @Post(':year/:month/generate')
  @RequirePermissions('payroll.manage')
  generate(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.payroll.generate(
      user,
      shopId,
      Number(year),
      Number(month),
      includeInactive === 'true',
    );
  }
}
