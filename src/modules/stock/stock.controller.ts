import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, AuthUser } from '../../common/decorators';
import { PermissionsGuard, resolveUserPermissions } from '../../common/guards';
import { Permission } from '../../common/enums';
import { StockService } from './stock.service';
import {
  StockKind,
  parseStockKind,
  stockManagePermission,
  stockReadPermission,
} from './stock-kind';

class NewCategoryInlineDto {
  @ApiProperty() @IsString() @MinLength(1) name: string;
}

class CreateCategoryDto {
  @ApiProperty() @IsString() @MinLength(1) name: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateCategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class CreateProductDto {
  @ApiProperty() @IsString() @MinLength(1) name: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string | null;
  @ApiPropertyOptional({ type: NewCategoryInlineDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewCategoryInlineDto)
  newCategory?: NewCategoryInlineDto | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) minQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maxQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateProductDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) name?: string;
  @ApiPropertyOptional() @IsOptional() categoryId?: string | null;
  @ApiPropertyOptional({ type: NewCategoryInlineDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewCategoryInlineDto)
  newCategory?: NewCategoryInlineDto | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) minQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maxQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class AdjustQuantityDto {
  @ApiProperty({ description: '+1 o -1' })
  @IsNumber()
  delta: number;
}

class RestockProductsDto {
  @ApiProperty({ type: [String], description: 'IDs de productos a reponer al máximo' })
  @IsArray()
  @IsUUID('4', { each: true })
  productIds: string[];
}

class ShareStockDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'IDs de administradores de stock a notificar. Si se omite, se notifica a todos.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  recipientUserIds?: string[];
}

@ApiTags('stock')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  private assertPermission(
    user: AuthUser,
    shopId: string,
    permission: Permission,
  ) {
    const perms = resolveUserPermissions(user, shopId);
    if (!perms.includes(permission)) {
      throw new ForbiddenException('Sin permiso');
    }
  }

  private resolveKind(kindRaw?: string): StockKind {
    return parseStockKind(kindRaw);
  }

  @Get('categories')
  listCategories(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('kind') kindRaw?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const kind = this.resolveKind(kindRaw);
    this.assertPermission(user, shopId, stockReadPermission(kind));
    return this.stock.listCategories(user, shopId, kind, includeInactive === 'true');
  }

  @Post('categories')
  createCategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateCategoryDto,
    @Query('kind') kindRaw?: string,
  ) {
    const kind = this.resolveKind(kindRaw);
    this.assertPermission(user, shopId, stockManagePermission(kind));
    return this.stock.createCategory(user, shopId, kind, dto);
  }

  @Patch('categories/:id')
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @Query('kind') kindRaw?: string,
  ) {
    const kind = this.resolveKind(kindRaw);
    this.assertPermission(user, shopId, stockManagePermission(kind));
    return this.stock.updateCategory(user, shopId, kind, id, dto);
  }

  @Delete('categories/:id')
  removeCategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Query('kind') kindRaw?: string,
  ) {
    const kind = this.resolveKind(kindRaw);
    this.assertPermission(user, shopId, stockManagePermission(kind));
    return this.stock.removeCategory(user, shopId, kind, id);
  }

  @Get('products')
  listProducts(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('kind') kindRaw?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const kind = this.resolveKind(kindRaw);
    this.assertPermission(user, shopId, stockReadPermission(kind));
    return this.stock.listProducts(user, shopId, kind, includeInactive === 'true');
  }

  @Get('admins')
  listStockAdmins(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('kind') kindRaw?: string,
  ) {
    const kind = this.resolveKind(kindRaw);
    this.assertPermission(user, shopId, stockReadPermission(kind));
    return this.stock.listStockAdmins(user, shopId, kind);
  }

  @Post('share')
  shareStock(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: ShareStockDto,
    @Query('kind') kindRaw?: string,
  ) {
    const kind = this.resolveKind(kindRaw);
    this.assertPermission(user, shopId, stockReadPermission(kind));
    return this.stock.shareStock(user, shopId, kind, dto.recipientUserIds);
  }

  @Post('products')
  createProduct(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateProductDto,
    @Query('kind') kindRaw?: string,
  ) {
    const kind = this.resolveKind(kindRaw);
    this.assertPermission(user, shopId, stockManagePermission(kind));
    return this.stock.createProduct(user, shopId, kind, dto);
  }

  @Patch('products/:id')
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @Query('kind') kindRaw?: string,
  ) {
    const kind = this.resolveKind(kindRaw);
    this.assertPermission(user, shopId, stockManagePermission(kind));
    return this.stock.updateProduct(user, shopId, kind, id, dto);
  }

  @Post('products/restock')
  restock(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: RestockProductsDto,
    @Query('kind') kindRaw?: string,
  ) {
    const kind = this.resolveKind(kindRaw);
    this.assertPermission(user, shopId, stockManagePermission(kind));
    return this.stock.restockProducts(user, shopId, kind, dto.productIds);
  }

  @Post('products/:id/adjust')
  adjust(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: AdjustQuantityDto,
    @Query('kind') kindRaw?: string,
  ) {
    const kind = this.resolveKind(kindRaw);
    this.assertPermission(user, shopId, stockManagePermission(kind));
    if (dto.delta !== 1 && dto.delta !== -1) {
      throw new BadRequestException('El ajuste debe ser +1 o -1');
    }
    return this.stock.adjustQuantity(user, shopId, kind, id, dto.delta);
  }

  @Delete('products/:id')
  removeProduct(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Query('kind') kindRaw?: string,
  ) {
    const kind = this.resolveKind(kindRaw);
    this.assertPermission(user, shopId, stockManagePermission(kind));
    return this.stock.removeProduct(user, shopId, kind, id);
  }
}
