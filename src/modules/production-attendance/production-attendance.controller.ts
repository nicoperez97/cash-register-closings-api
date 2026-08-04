import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { ProductionAttendanceService } from './production-attendance.service';
import { ProductionAttendanceExcelImportService } from './production-attendance-excel-import.service';

class UpsertProductionAttendanceDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPresent?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) hours?: number;
}

class BulkProductionAttendanceDto {
  @ApiProperty({ type: [UpsertProductionAttendanceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertProductionAttendanceDto)
  items: UpsertProductionAttendanceDto[];
}

@ApiTags('production-attendance')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/production-attendance')
export class ProductionAttendanceController {
  constructor(
    private readonly attendance: ProductionAttendanceService,
    private readonly excelImport: ProductionAttendanceExcelImportService,
  ) {}

  @Get()
  @RequirePermissions('attendance.read')
  async month(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    const y = Number(year) || new Date().getFullYear();
    const m = Number(month) || new Date().getMonth() + 1;
    return this.attendance.getMonth(user, shopId, y, m);
  }

  @Get('export.xlsx')
  @RequirePermissions('attendance.read')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @Res() res: Response,
  ) {
    const y = Number(year) || new Date().getFullYear();
    const m = Number(month) || new Date().getMonth() + 1;
    const { buffer, filename } = await this.excelImport.exportMonth(user, shopId, y, m);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('import-template.xlsx')
  @RequirePermissions('attendance.manage')
  async importTemplate(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.excelImport.buildTemplate(user, shopId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post('import-excel')
  @RequirePermissions('attendance.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        commit: { type: 'boolean' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  importExcel(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('commit') commit?: string,
    @Body('commit') commitBody?: string | boolean,
  ) {
    if (!file) throw new BadRequestException('Adjuntá el Excel (.xlsx)');
    const doCommit =
      commit === 'true' ||
      commit === '1' ||
      commitBody === true ||
      commitBody === 'true' ||
      commitBody === '1';
    return doCommit
      ? this.excelImport.commit(user, shopId, file)
      : this.excelImport.preview(user, shopId, file);
  }

  @Post()
  @RequirePermissions('attendance.manage')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: UpsertProductionAttendanceDto,
  ) {
    return this.attendance.upsertDay(user, shopId, dto);
  }

  @Post('bulk')
  @RequirePermissions('attendance.manage')
  bulk(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: BulkProductionAttendanceDto,
  ) {
    return this.attendance.bulkUpsert(user, shopId, dto.items ?? []);
  }
}
