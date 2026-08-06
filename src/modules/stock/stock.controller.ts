import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { StockService } from './stock.service';

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

@ApiTags('stock')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('categories')
  @RequirePermissions('stock.read')
  listCategories(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.stock.listCategories(user, shopId, includeInactive === 'true');
  }

  @Post('categories')
  @RequirePermissions('stock.manage')
  createCategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.stock.createCategory(user, shopId, dto);
  }

  @Patch('categories/:id')
  @RequirePermissions('stock.manage')
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.stock.updateCategory(user, shopId, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions('stock.manage')
  removeCategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.stock.removeCategory(user, shopId, id);
  }

  @Get('products')
  @RequirePermissions('stock.read')
  listProducts(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.stock.listProducts(user, shopId, includeInactive === 'true');
  }

  @Post('products')
  @RequirePermissions('stock.manage')
  createProduct(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.stock.createProduct(user, shopId, dto);
  }

  @Patch('products/:id')
  @RequirePermissions('stock.manage')
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.stock.updateProduct(user, shopId, id, dto);
  }

  @Post('products/restock')
  @RequirePermissions('stock.manage')
  restock(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: RestockProductsDto,
  ) {
    return this.stock.restockProducts(user, shopId, dto.productIds);
  }

  @Post('products/:id/adjust')
  @RequirePermissions('stock.manage')
  adjust(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: AdjustQuantityDto,
  ) {
    if (dto.delta !== 1 && dto.delta !== -1) {
      throw new BadRequestException('El ajuste debe ser +1 o -1');
    }
    return this.stock.adjustQuantity(user, shopId, id, dto.delta);
  }

  @Delete('products/:id')
  @RequirePermissions('stock.manage')
  removeProduct(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.stock.removeProduct(user, shopId, id);
  }
}
