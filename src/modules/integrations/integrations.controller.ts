import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import {
  AuthUser,
  CurrentUser,
  Public,
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { DeliverateWebhookDto, UpsertDeliverateConfigDto } from './dto/deliverate.dto';
import { IntegrationsService } from './integrations.service';

function requestApiOrigin(
  req: Request,
  forwardedProto?: string,
  forwardedHost?: string,
): string | null {
  const proto =
    String(forwardedProto ?? '')
      .split(',')[0]
      ?.trim() ||
    (req.protocol ? String(req.protocol) : '') ||
    'https';
  const host =
    String(forwardedHost ?? '')
      .split(',')[0]
      ?.trim() ||
    String(req.get('host') ?? '').trim();
  if (!host) return null;
  return `${proto}://${host}`.replace(/\/+$/, '');
}

@ApiTags('webhooks')
@Controller('webhooks')
export class IntegrationsWebhookController {
  constructor(private readonly service: IntegrationsService) {}

  @Public()
  @Post('deliverate')
  handleDeliverate(@Body() body: DeliverateWebhookDto) {
    return this.service.handleWebhook(body);
  }
}

@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/integrations/deliverate')
export class DeliverateIntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  @Get()
  @RequireAnyPermissions('integrations.read', 'integrations.manage', 'customerOrders.manage')
  get(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.service.getDeliverateConfig(user, shopId);
  }

  @Put()
  @RequirePermissions('integrations.manage')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: UpsertDeliverateConfigDto,
    @Req() req: Request,
    @Headers('x-forwarded-proto') forwardedProto?: string,
    @Headers('x-forwarded-host') forwardedHost?: string,
  ) {
    return this.service.upsertDeliverateConfig(user, shopId, dto, {
      requestApiOrigin: requestApiOrigin(req, forwardedProto, forwardedHost),
    });
  }

  @Post('test')
  @RequirePermissions('integrations.manage')
  test(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.service.testDeliverate(user, shopId);
  }
}

@ApiTags('customer-orders-deliverate')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/customer-orders/:orderId/deliverate')
export class CustomerOrderDeliverateController {
  constructor(private readonly service: IntegrationsService) {}

  @Post('request')
  @RequireAnyPermissions('integrations.manage', 'customerOrders.manage')
  request(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.service.requestDeliverate(user, shopId, orderId);
  }

  @Get('dboy-location')
  @RequireAnyPermissions(
    'integrations.manage',
    'customerOrders.manage',
    'customerOrders.read',
  )
  dboyLocation(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.service.getDboyLocation(user, shopId, orderId);
  }
}
