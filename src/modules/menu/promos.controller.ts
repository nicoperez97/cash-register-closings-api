import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthUser,
  CurrentUser,
  RequireAnyPermissions,
} from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import type { ShopPromo } from '../../common/shop-promos';
import { MenuService } from './menu.service';

@ApiTags('promos')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/promos')
export class PromosController {
  constructor(private readonly menus: MenuService) {}

  @Get()
  @RequireAnyPermissions('shops.manage', 'orderingCatalog.manage', 'customerOrders.manage')
  get(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.menus.getPromosAdmin(user, shopId);
  }

  @Put()
  @RequireAnyPermissions('shops.manage', 'orderingCatalog.manage')
  save(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() body: { promos?: ShopPromo[] } | ShopPromo[],
  ) {
    return this.menus.savePromosAdmin(user, shopId, body);
  }
}
