import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { UserActivityService } from './user-activity.service';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { parseClosingFilters } from '../closings/closing-filters';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly userActivityService: UserActivityService,
  ) {}

  private conceptFilters(query: Record<string, string | undefined>): {
    from?: string;
    to?: string;
    kind?: 'INCOME' | 'EXPENSE' | 'TRANSFER';
    conceptId?: string;
  } {
    const base = parseClosingFilters(query);
    const kindRaw = (query.kind ?? '').trim().toUpperCase();
    const kind: 'INCOME' | 'EXPENSE' | 'TRANSFER' | undefined =
      kindRaw === 'INCOME' || kindRaw === 'EXPENSE' || kindRaw === 'TRANSFER'
        ? kindRaw
        : undefined;
    return {
      from: base.from,
      to: base.to,
      kind,
      conceptId: (query.conceptId ?? '').trim() || undefined,
    };
  }

  @Get('dashboard')
  @RequirePermissions('reports.view')
  dashboard(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.reports.dashboard(user, shopId, parseClosingFilters(query));
  }

  @Get('summary')
  @RequirePermissions('reports.view')
  summary(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.reports.summary(user, shopId, parseClosingFilters(query));
  }

  @Get('movements/summary')
  @RequirePermissions('reports.view')
  movementsSummary(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.reports.movementsSummary(user, shopId, parseClosingFilters(query));
  }

  @Get('expenses-by-concept')
  @RequirePermissions('reports.view')
  expensesByConcept(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.reports.expensesByConcept(user, shopId, parseClosingFilters(query));
  }

  @Get('concepts/export.xlsx')
  @RequirePermissions('reports.export')
  async conceptsExport(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.reports.exportConceptsExcel(
      user,
      shopId,
      this.conceptFilters(query),
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('concepts')
  @RequirePermissions('reports.view')
  concepts(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.reports.conceptsAnalytics(user, shopId, this.conceptFilters(query));
  }

  @Get('user-activity')
  @RequirePermissions('users.manage')
  userActivity(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const base = parseClosingFilters(query);
    return this.userActivityService.ranking(user, shopId, { from: base.from, to: base.to });
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
