import {
  BadRequestException,
  Body,
  Controller,
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
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { SalesReportImportService } from './sales-report-import.service';
import {
  parseSalesProductsFilters,
  SalesProductsAnalyticsService,
} from './sales-products-analytics.service';

class UpdatePosProductDto {
  @ApiPropertyOptional() @IsOptional() @IsString() productName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string | null;
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
  ) {}

  @Post('shops/:shopId/sales-reports/import-excel')
  @RequirePermissions('closings.create')
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
}
