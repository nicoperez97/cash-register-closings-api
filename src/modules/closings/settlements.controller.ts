import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { SettlementsService } from './settlements.service';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { SettleClosingSourcesDto } from './dto/settlement.dto';

@ApiTags('settlements')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('pending')
  @RequirePermissions('closings.read')
  listPending(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.settlements.listPending(user, shopId);
  }

  @Get('history')
  @RequirePermissions('closings.read')
  listHistory(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.settlements.listHistory(user, shopId);
  }

  @Post('settle')
  @RequirePermissions('closings.update')
  settle(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: SettleClosingSourcesDto,
  ) {
    return this.settlements.settle(user, shopId, dto);
  }
}
