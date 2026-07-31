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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { SalesReportImportService } from './sales-report-import.service';
import {
  parseSalesProductsFilters,
  SalesProductsAnalyticsService,
} from './sales-products-analytics.service';
import { PosCatalogService } from './pos-catalog.service';

class UpdatePosProductDto {
  @ApiPropertyOptional() @IsOptional() @IsString() productName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() subcategory?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v != null) @IsUUID() categoryId?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v != null) @IsUUID() subcategoryId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class CreateCategoryDto {
  @ApiProperty() @IsString() @MinLength(1) name: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
}

class UpdateCategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class CreateSubcategoryDto {
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty() @IsString() @MinLength(1) name: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
}

class UpdateSubcategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('sales-reports')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller()
export class SalesReportsController {
  constructor(
    private readonly imports: SalesReportImportService,
    private readonly analytics: SalesProductsAnalyticsService,
    private readonly catalog: PosCatalogService,
  ) {}

  @Post('shops/:shopId/sales-reports/import-excel')
  @RequirePermissions('reports.export')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  importExcel(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('commit') commit?: string,
  ) {
    const doCommit = commit === 'true' || commit === '1';
    return doCommit
      ? this.imports.commit(user, shopId, file)
      : this.imports.preview(user, shopId, file);
  }

  @Get('shops/:shopId/sales-reports/products/summary')
  @RequirePermissions('reports.view')
  productsSummary(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const filters = parseSalesProductsFilters(query);
    if (!filters) throw new BadRequestException('Parámetros from y to son obligatorios');
    return this.analytics.summary(user, shopId, filters);
  }

  @Get('shops/:shopId/sales-reports/products/export.xlsx')
  @RequirePermissions('reports.export')
  async productsExport(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const filters = parseSalesProductsFilters(query);
    if (!filters) throw new BadRequestException('Parámetros from y to son obligatorios');
    const { buffer, filename } = await this.analytics.exportExcel(user, shopId, filters);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('shops/:shopId/pos-products')
  @RequirePermissions('reports.view')
  listProducts(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('q') q?: string,
  ) {
    return this.analytics.listCatalog(user, shopId, q);
  }

  @Patch('shops/:shopId/pos-products/:id')
  @RequirePermissions('shops.manage')
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePosProductDto,
  ) {
    return this.analytics.updateCatalog(user, shopId, id, dto);
  }

  @Post('shops/:shopId/pos-catalog/seed-from-report')
  @RequirePermissions('shops.manage')
  seedCatalog(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.catalog.seedFromReport(user, shopId);
  }

  @Get('shops/:shopId/pos-categories')
  @RequirePermissions('reports.view')
  listCategories(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.catalog.listCategories(user, shopId);
  }

  @Post('shops/:shopId/pos-categories')
  @RequirePermissions('shops.manage')
  createCategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.catalog.createCategory(user, shopId, dto);
  }

  @Patch('shops/:shopId/pos-categories/:id')
  @RequirePermissions('shops.manage')
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(user, shopId, id, dto);
  }

  @Delete('shops/:shopId/pos-categories/:id')
  @RequirePermissions('shops.manage')
  removeCategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.catalog.removeCategory(user, shopId, id);
  }

  @Get('shops/:shopId/pos-subcategories')
  @RequirePermissions('reports.view')
  listSubcategories(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.catalog.listSubcategories(user, shopId, categoryId);
  }

  @Post('shops/:shopId/pos-subcategories')
  @RequirePermissions('shops.manage')
  createSubcategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateSubcategoryDto,
  ) {
    return this.catalog.createSubcategory(user, shopId, dto);
  }

  @Patch('shops/:shopId/pos-subcategories/:id')
  @RequirePermissions('shops.manage')
  updateSubcategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSubcategoryDto,
  ) {
    return this.catalog.updateSubcategory(user, shopId, id, dto);
  }

  @Delete('shops/:shopId/pos-subcategories/:id')
  @RequirePermissions('shops.manage')
  removeSubcategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.catalog.removeSubcategory(user, shopId, id);
  }
}
