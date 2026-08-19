import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CashWithdrawalsService } from './cash-withdrawals.service';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { PickCashWithdrawalsDto } from './dto/cash-withdrawal.dto';

@ApiTags('cash-withdrawals')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/cash-withdrawals')
export class CashWithdrawalsController {
  constructor(private readonly withdrawals: CashWithdrawalsService) {}

  @Get('pending')
  @RequirePermissions('cashWithdrawals.read')
  listPending(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.withdrawals.listPending(user, shopId);
  }

  @Get('history')
  @RequirePermissions('cashWithdrawals.read')
  listHistory(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.withdrawals.listHistory(user, shopId);
  }

  @Post('pick')
  @RequirePermissions('cashWithdrawals.manage')
  pick(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: PickCashWithdrawalsDto,
  ) {
    return this.withdrawals.pick(user, shopId, dto);
  }
}
