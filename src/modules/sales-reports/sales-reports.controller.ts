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
import { ToBoolean } from '../../common/boolean.util';
import {
  CurrentUser,
  AuthUser,
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { SalesReportImportService } from './sales-report-import.service';
import {
  parseSalesProductsFilters,
  SalesProductsAnalyticsService,
} from './sales-products-analytics.service';
import { MenuSalesAnalyticsService } from './menu-sales-analytics.service';
import { PosCatalogService } from './pos-catalog.service';
import type { SalesReportProductLabelOverride } from './sales-report-import.service';

function parseProductLabelsBody(raw?: string): SalesReportProductLabelOverride[] | null {
  if (raw == null || String(raw).trim() === '') return null;
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(parsed)) return null;
    const out: SalesReportProductLabelOverride[] = [];
    for (const row of parsed) {
      const r = row as Record<string, unknown>;
      const productCode = String(r?.productCode ?? '').trim();
      if (!productCode) continue;
      out.push({
        productCode,
        productName:
          r.productName == null || r.productName === ''
            ? null
            : String(r.productName).trim(),
        category:
          r.category == null || r.category === '' ? null : String(r.category).trim(),
        subcategory:
          r.subcategory == null || r.subcategory === ''
            ? null
            : String(r.subcategory).trim(),
      });
    }
    return out.length ? out : null;
  } catch {
    throw new BadRequestException('productLabels debe ser JSON válido');
  }
}

class UpdatePosProductDto {
  @ApiPropertyOptional() @IsOptional() @IsString() productName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() subcategory?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v != null) @IsUUID() categoryId?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, v) => v != null) @IsUUID() subcategoryId?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Ítem de carta enlazado (null = sin enlace)' })
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  menuItemId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  active?: boolean;
}

class LinkCommitDto {
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        menuItemId: { type: 'string', nullable: true },
      },
    },
  })
  @IsOptional()
  links: Array<{ productId: string; menuItemId?: string | null }>;
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
  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  active?: boolean;
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
  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  active?: boolean;
}

@ApiTags('sales-reports')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller()
export class SalesReportsController {
  constructor(
    private readonly imports: SalesReportImportService,
    private readonly analytics: SalesProductsAnalyticsService,
    private readonly menuSales: MenuSalesAnalyticsService,
    private readonly catalog: PosCatalogService,
  ) {}

  @Post('shops/:shopId/sales-reports/import-excel')
  @RequireAnyPermissions('reports.export', 'reportsProducts.read')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        productLabels: {
          type: 'string',
          description: 'JSON: [{ productCode, productName?, category?, subcategory? }]',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('productLabels') productLabelsRaw?: string,
    @Query('commit') commit?: string,
  ) {
    await this.analytics.assertImportAllowed(user, shopId);
    const doCommit = commit === 'true' || commit === '1';
    const productLabels = doCommit ? parseProductLabelsBody(productLabelsRaw) : null;
    return doCommit
      ? this.imports.commit(user, shopId, file, productLabels)
      : this.imports.preview(user, shopId, file);
  }

  @Get('shops/:shopId/sales-reports/products/summary')
  @RequirePermissions('reportsProducts.read')
  productsSummary(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const filters = parseSalesProductsFilters(query);
    if (!filters) throw new BadRequestException('Parámetros from y to son obligatorios');
    return this.analytics.summary(user, shopId, filters);
  }

  /** Ventas de carta: pedidos online + mostrador + comanda (no Restosoft). */
  @Get('shops/:shopId/sales-reports/menu/summary')
  @RequirePermissions('reportsSales.read')
  menuSummary(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const filters = parseSalesProductsFilters(query);
    if (!filters) throw new BadRequestException('Parámetros from y to son obligatorios');
    return this.menuSales.summary(user, shopId, filters);
  }

  /** Preview: platos enlazados y cuánto vendieron en Ventas POS (para Traer a Ventas). */
  @Get('shops/:shopId/sales-reports/menu/pos-linked-preview')
  @RequirePermissions('reportsSales.read')
  menuPosLinkedPreview(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const filters = parseSalesProductsFilters(query);
    if (!filters) throw new BadRequestException('Parámetros from y to son obligatorios');
    return this.menuSales.posLinkedPreview(user, shopId, filters);
  }

  @Get('shops/:shopId/sales-reports/products/export.xlsx')
  @RequireAnyPermissions('reports.export', 'reportsProducts.read')
  async productsExport(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const filters = parseSalesProductsFilters(query);
    if (!filters) throw new BadRequestException('Parámetros from y to son obligatorios');
    await this.analytics.assertExportAllowed(user, shopId);
    const { buffer, filename } = await this.analytics.exportExcel(user, shopId, filters);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('shops/:shopId/pos-products')
  @RequireAnyPermissions('reportsProducts.read', 'shops.manage')
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

  @Post('shops/:shopId/pos-catalog/link-suggest')
  @RequirePermissions('shops.manage')
  linkSuggest(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.catalog.suggestMenuLinks(user, shopId);
  }

  @Post('shops/:shopId/pos-catalog/link-commit')
  @RequirePermissions('shops.manage')
  linkCommit(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: LinkCommitDto,
  ) {
    const links = (dto.links ?? []).map((l) => ({
      productId: String(l.productId ?? ''),
      menuItemId: l.menuItemId == null || l.menuItemId === '' ? null : String(l.menuItemId),
    }));
    return this.catalog.commitMenuLinks(user, shopId, links);
  }

  @Post('shops/:shopId/pos-catalog/seed-from-report')
  @RequirePermissions('shops.manage')
  seedCatalog(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.catalog.seedFromReport(user, shopId);
  }

  @Get('shops/:shopId/pos-categories')
  @RequireAnyPermissions('reportsProducts.read', 'shops.manage')
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
  @RequireAnyPermissions('reportsProducts.read', 'shops.manage')
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
