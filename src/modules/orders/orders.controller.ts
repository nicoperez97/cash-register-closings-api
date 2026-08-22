import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { IsArray, IsDateString, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { OrdersService, OrderLineInput, OrderSource } from './orders.service';

class OrderLineDto {
  @IsString()
  source: OrderSource;
  @IsOptional()
  @IsString()
  productId?: string | null;
  @IsOptional()
  @IsString()
  shortageId?: string | null;
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  quantity: number;
}

class CreateOrderBodyDto {
  @IsDateString()
  orderDate: string;
  @IsOptional()
  @IsString()
  notes?: string | null;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines: OrderLineDto[];
}

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions('orders.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.orders.list(user, shopId, { from, to });
  }

  @Get(':id/invoice-file')
  @RequirePermissions('orders.read')
  async downloadInvoice(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, fileName, mime } = await this.orders.downloadInvoice(user, shopId, id);
    res.setHeader('Content-Type', mime);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(fileName)}"`,
    );
    return stream;
  }

  @Get(':id')
  @RequirePermissions('orders.read')
  one(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.orders.one(user, shopId, id);
  }

  @Post()
  @RequirePermissions('orders.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        orderDate: { type: 'string' },
        notes: { type: 'string' },
        lines: { type: 'string' },
      },
      required: ['file', 'orderDate', 'lines'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024, fieldSize: 4 * 1024 * 1024 },
    }),
  )
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('orderDate') orderDate?: string,
    @Body('notes') notes?: string,
    @Body('lines') linesRaw?: string,
  ) {
    if (!file) throw new BadRequestException('Adjuntá la factura');
    let lines: OrderLineInput[] = [];
    try {
      const parsed = typeof linesRaw === 'string' ? JSON.parse(linesRaw) : linesRaw;
      if (Array.isArray(parsed)) lines = parsed;
    } catch {
      throw new BadRequestException('Las líneas del pedido no son válidas');
    }
    return this.orders.create(user, shopId, { orderDate: orderDate ?? '', notes, lines }, file);
  }

  @Delete(':id')
  @RequirePermissions('orders.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.orders.remove(user, shopId, id);
  }
}
