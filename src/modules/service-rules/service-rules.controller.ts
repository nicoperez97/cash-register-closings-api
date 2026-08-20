import {
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
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { memoryStorage } from 'multer';
import { CurrentUser, AuthUser, RequirePermissions, Public } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { ServiceRulePhase } from '../../common/enums';
import { ServiceRulesService } from './service-rules.service';

const rulesUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

class CreateCategoryDto {
  @ApiProperty() @IsString() @MinLength(1) name: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}

class UpdateCategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class CreateRuleDto {
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty({ enum: ServiceRulePhase })
  @IsEnum(ServiceRulePhase)
  phase: ServiceRulePhase;
  @ApiProperty() @IsString() @MinLength(1) title: string;
  @ApiProperty() @IsString() @MinLength(1) body: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}

class UpdateRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: ServiceRulePhase })
  @IsOptional()
  @IsEnum(ServiceRulePhase)
  phase?: ServiceRulePhase;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) body?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class ImportRuleDto {
  @ApiProperty({ enum: ServiceRulePhase })
  @IsEnum(ServiceRulePhase)
  phase: ServiceRulePhase;
  @ApiProperty() @IsString() @MinLength(1) title: string;
  @ApiProperty() @IsString() @MinLength(1) body: string;
}

class ImportCategoryDto {
  @ApiProperty() @IsString() @MinLength(1) name: string;
  @ApiProperty({ type: [ImportRuleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRuleDto)
  rules: ImportRuleDto[];
}

class ImportDraftDto {
  @ApiProperty({ type: [ImportCategoryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportCategoryDto)
  categories: ImportCategoryDto[];
}

@ApiTags('service-rules')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/service-rules')
export class ServiceRulesController {
  constructor(private readonly serviceRules: ServiceRulesService) {}

  @Get()
  @RequirePermissions('serviceRules.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.serviceRules.list(user, shopId, includeInactive === 'true');
  }

  @Post('parse')
  @RequirePermissions('serviceRules.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(rulesUpload)
  parse(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.serviceRules.parseUpload(user, shopId, file);
  }

  @Post('import')
  @RequirePermissions('serviceRules.manage')
  importDraft(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: ImportDraftDto,
  ) {
    return this.serviceRules.importDraft(user, shopId, dto);
  }

  @Post('categories')
  @RequirePermissions('serviceRules.manage')
  createCategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.serviceRules.createCategory(user, shopId, dto);
  }

  @Patch('categories/:id')
  @RequirePermissions('serviceRules.manage')
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.serviceRules.updateCategory(user, shopId, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions('serviceRules.manage')
  removeCategory(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.serviceRules.removeCategory(user, shopId, id);
  }

  @Post()
  @RequirePermissions('serviceRules.manage')
  createRule(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateRuleDto,
  ) {
    return this.serviceRules.createRule(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('serviceRules.manage')
  updateRule(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRuleDto,
  ) {
    return this.serviceRules.updateRule(user, shopId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('serviceRules.manage')
  removeRule(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.serviceRules.removeRule(user, shopId, id);
  }
}

@ApiTags('public-service-rules')
@Controller('public/shops')
export class PublicServiceRulesController {
  constructor(private readonly serviceRules: ServiceRulesService) {}

  @Public()
  @Get(':slug/service-rules.pdf')
  async publicPdf(@Param('slug') slug: string, @Res() res: Response) {
    const { buffer, filename } = await this.serviceRules.publicPdf(slug);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Public()
  @Get(':slug/service-rules')
  publicBySlug(@Param('slug') slug: string) {
    return this.serviceRules.publicBySlug(slug);
  }
}
