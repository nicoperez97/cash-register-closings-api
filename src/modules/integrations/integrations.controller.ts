import {
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
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
import { UpsertDeliverateConfigDto } from './dto/deliverate.dto';
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
  private readonly logger = new Logger(IntegrationsWebhookController.name);

  constructor(private readonly service: IntegrationsService) {}

  /**
   * Sin DTO estricto: Deliverate a veces manda campos extra y
   * forbidNonWhitelisted devolvería 400 sin aplicar el update.
   */
  @Public()
  @Post('deliverate')
  handleDeliverate(
    @Body() body: Record<string, unknown>,
    @Query('token') token?: string,
    @Headers('x-webhook-secret') headerSecret?: string,
  ) {
    // Verificación opt-in: si DELIVERATE_WEBHOOK_SECRET está configurado, el
    // webhook exige el token (query ?token= o header x-webhook-secret). Sin la
    // env configurada, el comportamiento es el de siempre (compatibilidad).
    const secret = String(process.env.DELIVERATE_WEBHOOK_SECRET ?? '').trim();
    if (secret) {
      const provided = String(token ?? headerSecret ?? '').trim();
      if (provided !== secret) {
        this.logger.warn('Deliverate webhook rechazado: token inválido o ausente');
        throw new UnauthorizedException('Webhook no autorizado');
      }
    }
    const action = String(body?.action ?? '').trim();
    const rawUpdate = body?.update;
    const update =
      rawUpdate && typeof rawUpdate === 'object' && !Array.isArray(rawUpdate)
        ? (rawUpdate as Record<string, unknown>)
        : body;
    this.logger.log(
      `Deliverate webhook action=${action || '(vacío)'} order_id=${String(update?.order_id ?? '')} state=${String(update?.state ?? '')}`,
    );
    return this.service.handleWebhook({ action, update });
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
