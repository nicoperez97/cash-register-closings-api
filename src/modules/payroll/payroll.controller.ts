import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { PayrollService } from './payroll.service';

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
  ) {
    return this.payroll.generate(user, shopId, Number(year), Number(month));
  }

  @Post(':year/:month/lock')
  @RequirePermissions('payroll.manage')
  lock(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.payroll.lock(user, shopId, Number(year), Number(month));
  }
}
