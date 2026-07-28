import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { parseClosingFilters } from '../closings/closing-filters';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @RequirePermissions('reports.view')
  summary(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.reports.summary(user, shopId, parseClosingFilters(query));
  }

  @Get('export.xlsx')
  @RequirePermissions('reports.export')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.reports.exportExcel(
      user,
      shopId,
      parseClosingFilters(query),
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
