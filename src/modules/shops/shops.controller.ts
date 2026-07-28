import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ShopsService } from './shops.service';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { CreateShopDto, UpdateShopDto } from './dto/shop.dto';

@ApiTags('shops')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops')
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Get('mine')
  @RequirePermissions('closings.read')
  mine(@CurrentUser() user: AuthUser) {
    return this.shops.mine(user);
  }

  @Get()
  @RequirePermissions('closings.read')
  findAll(@CurrentUser() user: AuthUser) {
    return this.shops.findAll(user);
  }

  @Get(':id/users')
  listUsers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shops.listUsers(user, id);
  }

  @Get(':id')
  @RequirePermissions('closings.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shops.findOne(user, id);
  }

  @Post()
  @RequirePermissions('shops.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateShopDto) {
    return this.shops.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('shops.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateShopDto,
  ) {
    return this.shops.update(user, id, dto);
  }
}
