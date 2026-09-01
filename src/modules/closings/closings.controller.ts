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
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { ClosingsService } from './closings.service';
import { WhatsappImportService } from './whatsapp-import.service';
import { ExcelImportService } from './excel-import.service';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard, assertCanViewClosingsList } from '../../common/guards';
import { CreateClosingDto, UpdateClosingDto } from './dto/closing.dto';
import { parseClosingFilters } from './closing-filters';

@ApiTags('closings')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/closings')
export class ClosingsController {
  constructor(
    private readonly closings: ClosingsService,
    private readonly whatsappImport: WhatsappImportService,
    private readonly excelImport: ExcelImportService,
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
}
