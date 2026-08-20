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
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser, AuthUser, RequireAnyPermissions, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { ConceptCategory, ConceptKind } from '../../common/enums';
import { ConceptsService } from './concepts.service';
import { ConceptsExcelService } from './concepts-excel.service';
import { isPaymentConceptScope } from '../../common/concept-categories';

class CreateConceptDto {
  @ApiProperty() @IsString() @MinLength(1) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string | null;
  @ApiPropertyOptional({ enum: ConceptKind })
  @IsOptional()
  @IsEnum(ConceptKind)
  kind?: ConceptKind;
  @ApiPropertyOptional({ enum: ConceptCategory, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ConceptCategory, { each: true })
  categories?: ConceptCategory[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() validated?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateConceptDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string | null;
  @ApiPropertyOptional({ enum: ConceptKind })
  @IsOptional()
  @IsEnum(ConceptKind)
  kind?: ConceptKind;
  @ApiPropertyOptional({ enum: ConceptCategory, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ConceptCategory, { each: true })
  categories?: ConceptCategory[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() validated?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('concepts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/concepts')
export class ConceptsController {
  constructor(
    private readonly concepts: ConceptsService,
    private readonly excel: ConceptsExcelService,
  ) {}

  @Get()
  @RequireAnyPermissions(
    'expenses.read',
    'accountTransfers.read',
    'movements.read',
    'concepts.manage',
    'payments.read',
  )
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('kind') kind?: ConceptKind,
    @Query('includeInactive') includeInactive?: string,
    @Query('includeUnvalidated') includeUnvalidated?: string,
    @Query('for') usage?: string,
  ) {
    return this.concepts.list(user, shopId, {
      kind,
      includeInactive: includeInactive === 'true',
      includeUnvalidated: includeUnvalidated === 'true',
      for: isPaymentConceptScope(usage) ? usage : undefined,
    });
  }

  @Get('import-template.xlsx')
  @RequirePermissions('concepts.manage')
  async importTemplate(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.excel.buildTemplate(user, shopId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post('import-excel')
  @RequirePermissions('concepts.manage')
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
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
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
      ? this.excel.commit(user, shopId, file)
      : this.excel.preview(user, shopId, file);
  }

  @Post()
  @RequirePermissions('concepts.manage')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateConceptDto,
  ) {
    return this.concepts.create(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('concepts.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateConceptDto,
  ) {
    return this.concepts.update(user, shopId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('concepts.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.concepts.remove(user, shopId, id);
  }
}
