import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import { CustomerOrderStatus } from '../../entities/customer-order.entity';
import { CustomerOrdersService } from './customer-orders.service';
import {
  CreateCustomerOrderDto,
  UpdateCustomerOrderStatusDto,
} from './dto/customer-order.dto';

@ApiTags('public-customer-orders')
@Controller('public/shops/:slug')
export class PublicCustomerOrdersController {
  constructor(private readonly service: CustomerOrdersService) {}

  @Public()
  @Get('ordering')
  getOrdering(@Param('slug') slug: string) {
    return this.service.getPublicOrderingConfig(slug);
  }

  @Public()
  @Post('customer-orders')
  create(@Param('slug') slug: string, @Body() dto: CreateCustomerOrderDto) {
    return this.service.createPublic(slug, dto);
  }

  @Public()
  @Get('customer-orders/lookup')
  lookup(
    @Param('slug') slug: string,
    @Query('phone') phone: string,
    @Query('code') code: string,
  ) {
    return this.service.lookupPublic(slug, phone, code);
  }
}

@ApiTags('customer-orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/customer-orders')
export class CustomerOrdersController {
  constructor(private readonly service: CustomerOrdersService) {}

  @Get()
  @RequirePermissions('customerOrders.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('status') status?: string,
  ) {
    const statuses = status
      ? (status
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean) as CustomerOrderStatus[])
      : undefined;
    return this.service.listStaff(user, shopId, { status: statuses });
  }

  @Get(':id')
  @RequirePermissions('customerOrders.read')
  get(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.service.getStaff(user, shopId, id);
  }

  @Patch(':id/status')
  @RequirePermissions('customerOrders.manage')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerOrderStatusDto,
  ) {
    return this.service.updateStatus(user, shopId, id, dto);
  }
}
