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
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { MovementsService } from './movements.service';
import { MovementsExcelImportService } from './movements-excel-import.service';

class CreateMovementDto {
  @ApiProperty() @IsDateString() businessDate: string;
  @ApiProperty() @IsUUID() fromAccountId: string;
  @ApiProperty() @IsUUID() toAccountId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string | null;
  @ApiProperty() @IsNumber() @Min(0) amountUyu: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() usdRate?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() amountUsd?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() conceptId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() invoiced?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string | null;
}

class UpdateMovementDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() businessDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() fromAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() toAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) amountUyu?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() usdRate?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() amountUsd?: number | null;
  @ApiPropertyOptional() @IsOptional() conceptId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() invoiced?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() employeeId?: string | null;
}

@ApiTags('movements')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/movements')
export class MovementsController {
  constructor(
    private readonly movements: MovementsService,
    private readonly excelImport: MovementsExcelImportService,
  ) {}

  @Get()
  @RequirePermissions('movements.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('fromAccountId') fromAccountId?: string,
    @Query('toAccountId') toAccountId?: string,
    @Query('conceptId') conceptId?: string,
    @Query('closingId') closingId?: string,
    @Query('q') q?: string,
  ) {
    return this.movements.list(user, shopId, {
      from,
      to,
      fromAccountId,
      toAccountId,
      conceptId,
      closingId,
      q,
    });
  }

  @Get('expenses-by-concept')
  @RequirePermissions('movements.read')
  expensesByConcept(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.movements.expensesByConcept(user, shopId, { from, to });
  }

  @Get('balances')
  @RequirePermissions('movements.read')
  balances(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.movements.balances(user, shopId, { from, to });
  }

  @Get('import-template.xlsx')
  @RequirePermissions('movements.manage')
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
  @RequirePermissions('movements.manage')
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

  @Get(':id')
  @RequirePermissions('movements.read')
  one(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.movements.one(user, shopId, id);
  }

  @Post()
  @RequirePermissions('movements.manage')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateMovementDto,
  ) {
    return this.movements.create(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('movements.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMovementDto,
  ) {
    return this.movements.update(user, shopId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('movements.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.movements.remove(user, shopId, id);
  }
}
