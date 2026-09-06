import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createReadStream } from 'fs';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { CashClosing } from '../../entities/cash-closing.entity';
import { ClosingStepFile, ClosingStepFileSlot, closingStepFileNeedsSource } from '../../entities/closing-step-file.entity';
import { ClosingStatus, GlobalRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators';
import { isGlobalAdmin } from '../../common/guards';
import { ShopsService } from '../shops/shops.service';
import { GeminiDocumentService } from '../ai/gemini-document.service';
import {
  deleteClosingUploads,
  deleteUploadIfExists,
  resolveUploadPath,
  saveUploadFile,
} from '../../common/uploads';

const MAX_FILES_PER_SLOT = 6;
const n = (v?: number | string | null) => Number(v ?? 0);

export type ClosingStepFileDto = {
  id: string;
  slot: ClosingStepFileSlot;
  sourceId: string | null;
  fileName: string;
  mime: string | null;
  parsedAmount: number | null;
};

export type ClosingStepParseResult = {
  amount: number | null;
  label: string | null;
  warning: string | null;
};

@Injectable()
export class ClosingStepFilesService implements OnModuleInit {
  private readonly logger = new Logger(ClosingStepFilesService.name);

  constructor(
    @InjectRepository(CashClosing) private readonly closings: Repository<CashClosing>,
    @InjectRepository(ClosingStepFile) private readonly files: Repository<ClosingStepFile>,
    private readonly shops: ShopsService,
    private readonly gemini: GeminiDocumentService,
  ) {}

  async onModuleInit() {
    try {
      await this.files.query(`
        CREATE TABLE IF NOT EXISTS closing_step_files (
          id CHAR(36) NOT NULL PRIMARY KEY,
          closingId CHAR(36) NOT NULL,
          slot VARCHAR(24) NOT NULL,
          sourceId VARCHAR(36) NULL,
          filePath VARCHAR(500) NOT NULL,
          fileName VARCHAR(255) NOT NULL,
          fileMime VARCHAR(120) NULL,
          parsedAmount DECIMAL(12,2) NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          KEY IDX_closing_step_files_closing (closingId)
        )
      `);
    } catch (err) {
      this.logger.warn(`No se pudo asegurar closing_step_files: ${(err as Error)?.message}`);
    }
  }

  async listForClosing(closingId: string): Promise<ClosingStepFileDto[]> {
    const rows = await this.files.find({
      where: { closingId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async parse(
    user: AuthUser,
    shopId: string,
    file: Express.Multer.File,
    slot: ClosingStepFileSlot,
    sourceName?: string | null,
  ): Promise<ClosingStepParseResult> {
    this.shops.assertShopAccess(user, shopId);
    this.assertCanWrite(user, shopId);
    this.assertFile(file);
    return this.parseAmount(file, slot, sourceName);
  }

  async upload(
    user: AuthUser,
    shopId: string,
    closingId: string,
    file: Express.Multer.File,
    slot: ClosingStepFileSlot,
    sourceId?: string | null,
    sourceName?: string | null,
  ) {
    this.shops.assertShopAccess(user, shopId);
    this.assertCanWrite(user, shopId);
    this.assertFile(file);
    const closing = await this.loadClosing(shopId, closingId);
    this.assertWritableClosing(user, closing);

    const needsSource = closingStepFileNeedsSource(slot);
    const count = await this.files.count({
      where: needsSource
        ? { closingId, slot, sourceId: sourceId || undefined }
        : { closingId, slot },
    });
    if (count >= MAX_FILES_PER_SLOT) {
      throw new BadRequestException('Ya hay demasiados archivos en este paso');
    }
    if (needsSource && !sourceId) {
      throw new BadRequestException(
        slot === 'posnet' ? 'Falta el posnet' : 'Falta la cuenta de canal',
      );
    }

    const parsed = await this.parseAmount(file, slot, sourceName);
    const id = randomUUID();
    const saved = saveUploadFile({
      relativeDir: `closings/${shopId}/${closingId}`,
      basename: id,
      buffer: file.buffer,
      originalName: file.originalname,
      mime: file.mimetype,
    });
    const row = await this.files.save(
      this.files.create({
        id,
        closingId,
        slot,
        sourceId: closingStepFileNeedsSource(slot) ? sourceId || null : null,
        filePath: saved.relativePath,
        fileName: file.originalname || saved.fileName,
        fileMime: file.mimetype || null,
        parsedAmount: parsed.amount != null ? parsed.amount.toFixed(2) : null,
      }),
    );
    return { file: this.toDto(row), ...parsed };
  }

  async download(user: AuthUser, shopId: string, closingId: string, fileId: string) {
    this.shops.assertShopAccess(user, shopId);
    await this.loadClosing(shopId, closingId);
    const row = await this.files.findOne({ where: { id: fileId, closingId } });
    if (!row) throw new NotFoundException('Archivo no encontrado');
    const abs = resolveUploadPath(row.filePath);
    if (!abs) throw new NotFoundException('Archivo no encontrado');
    return {
      stream: new StreamableFile(createReadStream(abs)),
      fileName: row.fileName || 'archivo',
      mime: row.fileMime || 'application/octet-stream',
    };
  }

  async remove(user: AuthUser, shopId: string, closingId: string, fileId: string) {
    this.shops.assertShopAccess(user, shopId);
    this.assertCanWrite(user, shopId);
    const closing = await this.loadClosing(shopId, closingId);
    this.assertWritableClosing(user, closing);
    const row = await this.files.findOne({ where: { id: fileId, closingId } });
    if (!row) throw new NotFoundException('Archivo no encontrado');
    deleteUploadIfExists(row.filePath);
    await this.files.delete({ id: fileId });
    return { ok: true };
  }

  async deleteForClosing(shopId: string, closingId: string): Promise<void> {
    const rows = await this.files.find({ where: { closingId } });
    for (const row of rows) deleteUploadIfExists(row.filePath);
    await this.files.delete({ closingId });
    deleteClosingUploads(shopId, closingId);
  }

  private async parseAmount(
    file: Express.Multer.File,
    slot: ClosingStepFileSlot,
    sourceName?: string | null,
  ): Promise<ClosingStepParseResult> {
    const prepared = await this.fileForParse(file);
    const ai = await this.gemini.parseClosingStepAmount(prepared, { slot, sourceName });
    if (ai.ok) {
      return {
        amount: ai.data.amount,
        label: ai.data.label,
        warning: ai.data.note,
      };
    }
    return {
      amount: null,
      label: null,
      warning:
        ai.reason === 'disabled'
          ? 'No se pudo leer el total. Completalo a mano.'
          : ai.message || 'No se pudo leer el total. Completalo a mano.',
    };
  }

  private async fileForParse(file: Express.Multer.File): Promise<Express.Multer.File> {
    const name = (file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    const isCsv = name.endsWith('.csv') || mime === 'text/csv' || mime === 'text/plain';
    if (isCsv) {
      return { ...file, mimetype: 'text/plain' };
    }
    const isExcel =
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      name.endsWith('.csv') ||
      mime.includes('spreadsheet') ||
      mime.includes('excel') ||
      mime === 'text/csv';
    if (!isExcel) return file;
    try {
      const text = await this.excelDigest(file.buffer);
      if (!text.trim()) return file;
      return {
        ...file,
        buffer: Buffer.from(text, 'utf8'),
        mimetype: 'text/plain',
        originalname: `${file.originalname || 'planilla'}.txt`,
      };
    } catch (err) {
      this.logger.warn(`No se pudo leer Excel de cierre: ${(err as Error)?.message}`);
      return file;
    }
  }

  private async excelDigest(buffer: Buffer): Promise<string> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const lines: string[] = [];
    for (const sheet of wb.worksheets.slice(0, 3)) {
      lines.push(`# ${sheet.name}`);
      let rows = 0;
      sheet.eachRow((row) => {
        if (rows >= 80) return;
        const cells = (row.values as unknown[])
          .slice(1, 16)
          .map((v) => String(v ?? '').trim())
          .filter(Boolean);
        if (cells.length) {
          lines.push(cells.join('\t'));
          rows += 1;
        }
      });
    }
    return lines.join('\n').slice(0, 20000);
  }

  private assertFile(file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Archivo requerido');
    const name = (file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    const ok =
      mime.startsWith('image/') ||
      mime === 'application/pdf' ||
      mime.includes('spreadsheet') ||
      mime.includes('excel') ||
      mime === 'text/csv' ||
      mime === 'text/plain' ||
      /\.(png|jpe?g|webp|gif|pdf|xlsx|xls|csv|txt)$/.test(name);
    if (!ok) {
      throw new BadRequestException('Usá una foto, un PDF o un Excel');
    }
  }

  private async loadClosing(shopId: string, id: string) {
    const row = await this.closings.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Cierre no encontrado');
    return row;
  }

  private assertCanWrite(user: AuthUser, shopId: string) {
    if (isGlobalAdmin(user.globalRole as GlobalRole)) return;
    const perms = user.shopPermissions?.[shopId] ?? user.permissions ?? [];
    if (perms.includes('closings.create') || perms.includes('closings.update')) return;
    throw new ForbiddenException('Sin permiso para cargar archivos del cierre');
  }

  private assertWritableClosing(user: AuthUser, closing: CashClosing) {
    if (closing.status === ClosingStatus.LOCKED && !isGlobalAdmin(user.globalRole as GlobalRole)) {
      throw new ForbiddenException('El cierre está bloqueado');
    }
  }

  private toDto(row: ClosingStepFile): ClosingStepFileDto {
    return {
      id: row.id,
      slot: row.slot,
      sourceId: row.sourceId ?? null,
      fileName: row.fileName,
      mime: row.fileMime ?? null,
      parsedAmount: row.parsedAmount != null ? n(row.parsedAmount) : null,
    };
  }
}
