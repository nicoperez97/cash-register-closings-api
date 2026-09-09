import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import {
  AuthUser,
  CurrentUser,
  Public,
  RequirePermissions,
} from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { PrintAgentService } from './print-agent.service';

@ApiTags('print-agent')
@Controller('print-agent')
export class PrintAgentController {
  constructor(private readonly service: PrintAgentService) {}

  @Public()
  @Get('session')
  session(@Headers('authorization') authorization?: string) {
    return this.service
      .resolveShopFromToken(authorization)
      .then((shop) => this.service.session(shop));
  }

  @Public()
  @Get('menu')
  menu(@Headers('authorization') authorization?: string) {
    return this.service
      .resolveShopFromToken(authorization)
      .then((shop) => this.service.getMenu(shop));
  }

  @Public()
  @Get('jobs')
  jobs(@Headers('authorization') authorization?: string) {
    return this.service
      .resolveShopFromToken(authorization)
      .then((shop) => this.service.listPendingJobs(shop));
  }

  @Public()
  @Post('jobs/:id/ack')
  ack(
    @Headers('authorization') authorization?: string,
    @Param('id') id?: string,
    @Body() body?: { status?: string; error?: string | null },
  ) {
    return this.service
      .resolveShopFromToken(authorization)
      .then((shop) => this.service.ackJob(shop, String(id ?? ''), body ?? {}));
  }

  @Public()
  @Post('jobs/test')
  test(@Headers('authorization') authorization?: string) {
    return this.service
      .resolveShopFromToken(authorization)
      .then((shop) => this.service.enqueueTest(shop));
  }
}

@ApiTags('shops-print-agent')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/print-agent')
export class ShopPrintAgentController {
  constructor(private readonly service: PrintAgentService) {}

  @Get()
  @RequirePermissions('shops.manage')
  status(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.service.getAdminStatus(user, shopId);
  }

  @Post('token')
  @RequirePermissions('shops.manage')
  generate(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.service.generateToken(user, shopId);
  }

  @Delete('token')
  @RequirePermissions('shops.manage')
  revoke(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.service.revokeToken(user, shopId);
  }
}
