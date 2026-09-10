import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthUser,
  CurrentUser,
  RequireAnyPermissions,
} from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { WaiterService } from './waiter.service';

@ApiTags('comanda')
@ApiBearerAuth()
@Controller('shops/:shopId/comanda')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class StaffComandaController {
  constructor(private readonly waiter: WaiterService) {}

  /** Emite un token de comanda para el usuario logueado (sin PIN). */
  @Post('enter')
  @RequireAnyPermissions(
    'customerOrders.read',
    'orderingCatalog.manage',
    'reservations.read',
    'shops.manage',
  )
  enter(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.waiter.staffEnter(user, shopId);
  }
}
