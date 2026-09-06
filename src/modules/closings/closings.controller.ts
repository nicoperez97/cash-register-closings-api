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
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { ClosingsService } from './closings.service';
import { WhatsappImportService } from './whatsapp-import.service';
import { ExcelImportService } from './excel-import.service';
import { ClosingStepFilesService } from './closing-step-files.service';
import { CurrentUser, AuthUser, RequireAnyPermissions, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard, assertCanViewClosingsList } from '../../common/guards';
import { CreateClosingDto, UpdateClosingDto } from './dto/closing.dto';
import { parseClosingFilters } from './closing-filters';
import { MulterExceptionFilter } from '../../common/filters/multer-exception.filter';
import {
  isClosingStepFileSlot,
  type ClosingStepFileSlot,
} from '../../entities/closing-step-file.entity';

@ApiTags('closings')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/closings')
export class ClosingsController {
  constructor(
    private readonly closings: ClosingsService,
    private readonly whatsappImport: WhatsappImportService,
    private readonly excelImport: ExcelImportService,
    private readonly stepFiles: ClosingStepFilesService,
  ) {}

  @Get()
  @RequirePermissions('closings.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    assertCanViewClosingsList(user, shopId);
    return this.closings.list(user, shopId, parseClosingFilters(query));
  }

  @Post('import-whatsapp')
  @RequirePermissions('closings.create')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        commit: { type: 'boolean', description: 'Si true, crea los cierres' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  importWhatsapp(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('commit') commit?: string,
    @Body('commit') commitBody?: string | boolean,
  ) {
    if (!file) throw new BadRequestException('Adjuntá el ZIP de WhatsApp');
    const doCommit =
      commit === 'true' ||
      commit === '1' ||
      commitBody === true ||
      commitBody === 'true' ||
      commitBody === '1';
    return doCommit
      ? this.whatsappImport.commit(user, shopId, file)
      : this.whatsappImport.preview(user, shopId, file);
  }

  @Get('import-template.xlsx')
  @RequirePermissions('closings.create')
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
  @RequirePermissions('closings.create')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        commit: { type: 'boolean', description: 'Si true, crea los cierres' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
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

  @Post('parse-step-file')
  @RequireAnyPermissions('closings.create', 'closings.update')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        slot: {
          type: 'string',
          enum: [
            'pos_system',
            'channel',
            'posnet',
            'card',
            'mercado_pago',
            'account_dni',
            'other',
          ],
        },
        sourceName: { type: 'string' },
      },
      required: ['file', 'slot'],
    },
  })
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024, fieldSize: 2 * 1024 * 1024 },
    }),
  )
  parseStepFile(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('slot') slot?: string,
    @Body('sourceName') sourceName?: string,
  ) {
    if (!file) throw new BadRequestException('Archivo requerido');
    return this.stepFiles.parse(user, shopId, file, this.parseSlot(slot), sourceName);
  }

  @Post('reload-incomes')
  @RequirePermissions('closings.create')
  reloadIncomes(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('commit') commit?: string,
    @Body()
    body?: {
      selected?: Array<{
        closingId: string;
        toAccountId: string;
        amount: number;
        label: string;
      }>;
    },
  ) {
    assertCanViewClosingsList(user, shopId);
    const doCommit = commit === 'true' || commit === '1';
    return doCommit
      ? this.closings.commitReloadIncomes(user, shopId, body?.selected)
      : this.closings.previewReloadIncomes(user, shopId);
  }

  @Get(':id')
  @RequirePermissions('closings.read')
  getOne(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.closings.getOne(user, shopId, id);
  }

  @Post()
  @RequirePermissions('closings.create')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateClosingDto,
  ) {
    return this.closings.create(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('closings.update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateClosingDto,
  ) {
    return this.closings.update(user, shopId, id, dto);
  }

  @Post(':id/lock')
  @RequirePermissions('closings.lock')
  lock(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.closings.lock(user, shopId, id);
  }

  @Post(':id/unlock')
  @RequirePermissions('closings.lock')
  unlock(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.closings.unlock(user, shopId, id);
  }

  @Delete(':id')
  @RequirePermissions('closings.update')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.closings.remove(user, shopId, id);
  }

  @Post(':id/step-files')
  @RequireAnyPermissions('closings.create', 'closings.update')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        slot: {
          type: 'string',
          enum: [
            'pos_system',
            'channel',
            'posnet',
            'card',
            'mercado_pago',
            'account_dni',
            'other',
          ],
        },
        sourceId: { type: 'string' },
        sourceName: { type: 'string' },
      },
      required: ['file', 'slot'],
    },
  })
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024, fieldSize: 2 * 1024 * 1024 },
    }),
  )
  uploadStepFile(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('slot') slot?: string,
    @Body('sourceId') sourceId?: string,
    @Body('sourceName') sourceName?: string,
  ) {
    if (!file) throw new BadRequestException('Archivo requerido');
    return this.stepFiles.upload(
      user,
      shopId,
      id,
      file,
      this.parseSlot(slot),
      sourceId || null,
      sourceName,
    );
  }

  @Get(':id/step-files/:fileId')
  @RequireAnyPermissions('closings.read', 'closings.create', 'closings.update')
  async downloadStepFile(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, fileName, mime } = await this.stepFiles.download(user, shopId, id, fileId);
    res.setHeader('Content-Type', mime);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(fileName)}"`,
    );
    return stream;
  }

  @Delete(':id/step-files/:fileId')
  @RequireAnyPermissions('closings.create', 'closings.update')
  removeStepFile(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.stepFiles.remove(user, shopId, id, fileId);
  }

  private parseSlot(raw?: string): ClosingStepFileSlot {
    const slot = String(raw ?? '').trim();
    if (isClosingStepFileSlot(slot)) return slot;
    throw new BadRequestException('Paso de archivo inválido');
  }
}
