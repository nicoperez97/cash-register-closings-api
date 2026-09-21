import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Public } from '../../common/decorators';
import {
  CurrentWaiter,
  WaiterAuthGuard,
  WaiterAuthPayload,
} from './waiter-auth';
import { WaiterService } from './waiter.service';

class WaiterLoginDto {
  @ApiProperty({ example: '1234' })
  @IsString()
  @MinLength(4)
  @MaxLength(6)
  pin: string;
}

class WaiterOrderItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  menuItemId: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  qty: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  removedIngredients?: string[];

  @ApiPropertyOptional({ description: 'Marcar como entrada en comanda de cocina' })
  @IsOptional()
  @IsBoolean()
  isEntrada?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Nombres de otros platos del envío con los que combina',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  combinesWithNames?: string[];
}

class WaiterOrderExtraDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  extraId: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  qty: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  attachedToMenuItemId?: string | null;
}

class OpenSessionDto {
  @ApiProperty()
  @IsUUID()
  salonTableId: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  covers: number;

  @ApiPropertyOptional({
    description: 'Mozo a cargo (requerido en comanda admin / staff)',
  })
  @IsOptional()
  @IsUUID()
  waiterEmployeeId?: string | null;
}

class CloseSessionPaymentDto {
  @ApiProperty()
  @IsString()
  @MaxLength(40)
  paymentMethodId: string;

  @ApiProperty({ example: 1000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;
}

class CloseSessionDto {
  @ApiPropertyOptional({
    description: 'Compat: un solo medio (si no mandás payments)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  paymentMethodId?: string;

  @ApiPropertyOptional({ type: [CloseSessionPaymentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => CloseSessionPaymentDto)
  payments?: CloseSessionPaymentDto[];

  @ApiPropertyOptional({ enum: ['none', 'percent', 'fixed'] })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  tipMode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tipValue?: number | null;
}

class PrintCustomerTicketDto {
  @ApiPropertyOptional({ enum: ['none', 'percent', 'fixed'] })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  discountMode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number | null;
}

class PatchSessionLineDto {
  @ApiProperty()
  @IsUUID()
  orderId: string;

  @ApiProperty({ description: 'Índice de la línea en order.items' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  lineIndex: number;

  @ApiPropertyOptional({ description: 'Nueva cantidad (0 = quitar)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  qty?: number | null;

  @ApiPropertyOptional({ description: 'Nuevo precio unitario' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number | null;

  @ApiPropertyOptional({ description: 'Quitar la línea (extra o ítem)' })
  @IsOptional()
  @IsBoolean()
  remove?: boolean;

  @ApiPropertyOptional({
    description: 'Motivo obligatorio al quitar o bajar cantidad',
    enum: ['cortesia', 'error', 'cambio_mesa', 'transfer', 'merma', 'otro'],
  })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  reason?: string | null;

  @ApiPropertyOptional({ description: 'Nota del motivo' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reasonNote?: string | null;
}

class WaiterOrderPromoDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  promoId: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  qty: number;
}

class PatchSessionPromoDto {
  @ApiPropertyOptional({ description: 'null = quitar promo de la mesa (legacy)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  promoId?: string | null;

  @ApiPropertyOptional({ description: 'null = ilimitado; omitir = no cambiar (legacy)' })
  @IsOptional()
  promoMaxCount?: number | null;

  @ApiPropertyOptional({
    description: 'Lista completa de promos de mesa (reemplaza). maxCount null = ilimitado.',
    type: 'array',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  promos?: Array<{ promoId: string; maxCount?: number | null }> | null;
}

class CreateSessionOrderDto {
  @ApiPropertyOptional({ type: [WaiterOrderItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => WaiterOrderItemDto)
  items?: WaiterOrderItemDto[];

  @ApiPropertyOptional({ type: [WaiterOrderExtraDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => WaiterOrderExtraDto)
  extras?: WaiterOrderExtraDto[];

  @ApiPropertyOptional({ type: [WaiterOrderPromoDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => WaiterOrderPromoDto)
  promos?: WaiterOrderPromoDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNotes?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  printKitchen?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  printCustomerTicket?: boolean;
}

@ApiTags('public-waiter')
@Controller('public/shops/:slug/waiter')
export class WaiterController {
  constructor(private readonly waiter: WaiterService) {}

  @Public()
  @Get()
  bootstrap(@Param('slug') slug: string) {
    return this.waiter.bootstrap(slug);
  }

  @Public()
  @Post('login')
  login(@Param('slug') slug: string, @Body() dto: WaiterLoginDto) {
    return this.waiter.login(slug, dto.pin);
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Get('me')
  me(@Param('slug') slug: string, @CurrentWaiter() waiter: WaiterAuthPayload) {
    return this.waiter.me(slug, waiter);
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Get('catalog')
  catalog(@Param('slug') slug: string, @CurrentWaiter() waiter: WaiterAuthPayload) {
    return this.waiter.catalog(slug, waiter);
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Get('tables')
  tables(@Param('slug') slug: string, @CurrentWaiter() waiter: WaiterAuthPayload) {
    return this.waiter.listTables(slug, waiter);
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Get('tips-summary')
  tipsSummary(
    @Param('slug') slug: string,
    @CurrentWaiter() waiter: WaiterAuthPayload,
  ) {
    return this.waiter.shiftTipsSummary(slug, waiter);
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Post('sessions')
  openSession(
    @Param('slug') slug: string,
    @CurrentWaiter() waiter: WaiterAuthPayload,
    @Body() dto: OpenSessionDto,
  ) {
    return this.waiter.openSession(
      slug,
      waiter,
      dto.salonTableId,
      dto.covers,
      dto.waiterEmployeeId,
    );
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Get('sessions/:id')
  getSession(
    @Param('slug') slug: string,
    @CurrentWaiter() waiter: WaiterAuthPayload,
    @Param('id') id: string,
  ) {
    return this.waiter.getSession(slug, waiter, id);
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Post('sessions/:id/discard')
  discardSession(
    @Param('slug') slug: string,
    @CurrentWaiter() waiter: WaiterAuthPayload,
    @Param('id') id: string,
  ) {
    return this.waiter.discardSession(slug, waiter, id);
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Post('sessions/:id/orders')
  createOrder(
    @Param('slug') slug: string,
    @CurrentWaiter() waiter: WaiterAuthPayload,
    @Param('id') id: string,
    @Body() dto: CreateSessionOrderDto,
  ) {
    return this.waiter.createSessionOrder(slug, waiter, id, dto);
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Post('sessions/:id/orders/:orderId/reprint-kitchen')
  reprintKitchen(
    @Param('slug') slug: string,
    @CurrentWaiter() waiter: WaiterAuthPayload,
    @Param('id') id: string,
    @Param('orderId') orderId: string,
  ) {
    return this.waiter.reprintSessionKitchen(slug, waiter, id, orderId);
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Patch('sessions/:id/promo')
  patchSessionPromo(
    @Param('slug') slug: string,
    @CurrentWaiter() waiter: WaiterAuthPayload,
    @Param('id') id: string,
    @Body() dto: PatchSessionPromoDto,
  ) {
    return this.waiter.patchSessionPromo(slug, waiter, id, {
      promoId: dto.promoId,
      promoMaxCount: dto.promoMaxCount,
      promos: dto.promos,
    });
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Patch('sessions/:id/lines')
  patchSessionLine(
    @Param('slug') slug: string,
    @CurrentWaiter() waiter: WaiterAuthPayload,
    @Param('id') id: string,
    @Body() dto: PatchSessionLineDto,
  ) {
    return this.waiter.patchSessionLine(slug, waiter, id, {
      orderId: dto.orderId,
      lineIndex: dto.lineIndex,
      qty: dto.qty,
      unitPrice: dto.unitPrice,
      remove: dto.remove,
      reason: dto.reason,
      reasonNote: dto.reasonNote,
    });
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Post('sessions/:id/fire-mains')
  fireSessionMains(
    @Param('slug') slug: string,
    @CurrentWaiter() waiter: WaiterAuthPayload,
    @Param('id') id: string,
  ) {
    return this.waiter.fireSessionMains(slug, waiter, id);
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Post('sessions/:id/print-customer-ticket')
  printCustomerTicket(
    @Param('slug') slug: string,
    @CurrentWaiter() waiter: WaiterAuthPayload,
    @Param('id') id: string,
    @Body() dto: PrintCustomerTicketDto,
  ) {
    return this.waiter.printCustomerTicket(slug, waiter, id, {
      discountMode: dto?.discountMode,
      discountValue: dto?.discountValue,
    });
  }

  @Public()
  @UseGuards(WaiterAuthGuard)
  @Post('sessions/:id/close')
  closeSession(
    @Param('slug') slug: string,
    @CurrentWaiter() waiter: WaiterAuthPayload,
    @Param('id') id: string,
    @Body() dto: CloseSessionDto,
  ) {
    return this.waiter.closeSession(slug, waiter, id, {
      paymentMethodId: dto?.paymentMethodId,
      payments: dto?.payments,
      tipMode: dto?.tipMode,
      tipValue: dto?.tipValue,
    });
  }
}
