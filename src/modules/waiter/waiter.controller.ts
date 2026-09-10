import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
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
}

class CloseSessionDto {
  @ApiPropertyOptional({ description: 'Imprimir ticket cliente al cerrar' })
  @IsOptional()
  @IsBoolean()
  printCustomerTicket?: boolean;
}

class CreateSessionOrderDto {
  @ApiProperty({ type: [WaiterOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => WaiterOrderItemDto)
  items: WaiterOrderItemDto[];

  @ApiPropertyOptional({ type: [WaiterOrderExtraDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => WaiterOrderExtraDto)
  extras?: WaiterOrderExtraDto[];

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
  @Post('sessions')
  openSession(
    @Param('slug') slug: string,
    @CurrentWaiter() waiter: WaiterAuthPayload,
    @Body() dto: OpenSessionDto,
  ) {
    return this.waiter.openSession(slug, waiter, dto.salonTableId, dto.covers);
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
  @Post('sessions/:id/print-customer-ticket')
  printCustomerTicket(
    @Param('slug') slug: string,
    @CurrentWaiter() waiter: WaiterAuthPayload,
    @Param('id') id: string,
  ) {
    return this.waiter.printCustomerTicket(slug, waiter, id);
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
      printCustomerTicket: !!dto?.printCustomerTicket,
    });
  }
}
