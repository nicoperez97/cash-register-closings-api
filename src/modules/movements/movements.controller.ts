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
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { NotifyTargetsDto } from '../../common/dto/notify-targets.dto';
import {
  CurrentUser,
  AuthUser,
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { MovementsService } from './movements.service';
import { MovementsExcelImportService } from './movements-excel-import.service';
import { MulterExceptionFilter } from '../../common/filters/multer-exception.filter';

class CreateMovementDto {
  @ApiProperty() @IsDateString() businessDate: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  fromAccountId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  toAccountId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  fromUserId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  toUserId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string | null;
  @ApiProperty() @IsNumber() @Min(0) amountUyu: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() usdRate?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() amountUsd?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() conceptId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() invoiced?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyAdmins?: boolean;
  @ApiPropertyOptional({ enum: ['cash', 'transfer', 'card'] })
  @IsOptional()
  @IsIn(['cash', 'transfer', 'card'])
  paymentMethod?: 'cash' | 'transfer' | 'card' | null;
  @ApiPropertyOptional({ enum: ['expense', 'income', 'transfer'] })
  @IsOptional()
  @IsIn(['expense', 'income', 'transfer'])
  kind?: 'expense' | 'income' | 'transfer';
}

class UpdateMovementDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() businessDate?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  fromAccountId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  toAccountId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  fromUserId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  toUserId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) amountUyu?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() usdRate?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() amountUsd?: number | null;
  @ApiPropertyOptional() @IsOptional() conceptId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() invoiced?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceNumber?: string | null;
  @ApiPropertyOptional() @IsOptional() employeeId?: string | null;
  @ApiPropertyOptional({ enum: ['expense', 'income', 'transfer'] })
  @IsOptional()
  @IsIn(['expense', 'income', 'transfer'])
  kind?: 'expense' | 'income' | 'transfer';
  @ApiPropertyOptional({ enum: ['cash', 'transfer', 'card'] })
  @IsOptional()
  @IsIn(['cash', 'transfer', 'card'])
  paymentMethod?: 'cash' | 'transfer' | 'card' | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyAdmins?: boolean;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  notifyUserIds?: string[];
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
  @RequireAnyPermissions('expenses.read', 'accountTransfers.read', 'incomes.read', 'movements.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('fromAccountId') fromAccountId?: string,
    @Query('toAccountId') toAccountId?: string,
    @Query('accountId') accountId?: string,
    @Query('conceptId') conceptId?: string,
    @Query('closingId') closingId?: string,
    @Query('q') q?: string,
    @Query('kind') kind?: 'expense' | 'income' | 'transfer',
    @Query('source') source?: 'closing' | 'payment' | 'manual',
    @Query('partyType') partyType?: 'supplier' | 'service' | 'employee',
    @Query('invoiced') invoiced?: string,
    @Query('paymentId') paymentId?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('employeeId') employeeId?: string,
    @Query('hasReceipt') hasReceipt?: string,
    @Query('shiftId') shiftId?: string,
  ) {
    return this.movements.list(user, shopId, {
      from,
      to,
      fromAccountId,
      toAccountId,
      accountId,
      conceptId,
      closingId,
      q,
      kind,
      source,
      partyType,
      invoiced,
      paymentId,
      paymentMethod,
      employeeId,
      hasReceipt,
      shiftId,
    });
  }

  @Get('expenses-by-concept')
  @RequirePermissions('expenses.read')
  expensesByConcept(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.movements.expensesByConcept(user, shopId, { from, to, kind: 'expense' });
  }

  @Get('balances')
  @RequireAnyPermissions('expenses.read', 'accountTransfers.read', 'incomes.read', 'movements.read')
  balances(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.movements.balances(user, shopId, { from, to });
  }

  @Get('balances/export.xlsx')
  @RequireAnyPermissions('expenses.read', 'accountTransfers.read', 'incomes.read', 'movements.read')
  async exportBalances(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.movements.exportBalancesXlsx(user, shopId, {
      from,
      to,
    });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('import-template.xlsx')
  @RequireAnyPermissions(
    'expenses.manage',
    'accountTransfers.manage',
    'incomes.manage',
    'movements.manage',
  )
  async importTemplate(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('kind') kind: 'expense' | 'income' | 'transfer' | undefined,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.excelImport.buildTemplate(
      user,
      shopId,
      kind === 'income' || kind === 'transfer' ? kind : 'expense',
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('export.xlsx')
  @RequireAnyPermissions('expenses.read', 'accountTransfers.read', 'incomes.read', 'movements.read')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('kind') kind: 'expense' | 'income' | 'transfer' | undefined,
    @Query('fromAccountId') fromAccountId: string | undefined,
    @Query('toAccountId') toAccountId: string | undefined,
    @Query('accountId') accountId: string | undefined,
    @Query('conceptId') conceptId: string | undefined,
    @Query('closingId') closingId: string | undefined,
    @Query('q') q: string | undefined,
    @Query('source') source: 'closing' | 'payment' | 'manual' | undefined,
    @Query('partyType') partyType: 'supplier' | 'service' | 'employee' | undefined,
    @Query('invoiced') invoiced: string | undefined,
    @Query('paymentId') paymentId: string | undefined,
    @Query('paymentMethod') paymentMethod: string | undefined,
    @Query('employeeId') employeeId: string | undefined,
    @Query('hasReceipt') hasReceipt: string | undefined,
    @Query('shiftId') shiftId: string | undefined,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.excelImport.exportRange(user, shopId, {
      from,
      to,
      kind,
      fromAccountId,
      toAccountId,
      accountId,
      conceptId,
      closingId,
      q,
      source,
      partyType,
      invoiced,
      paymentId,
      paymentMethod,
      employeeId,
      hasReceipt,
      shiftId,
    });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post('import-excel')
  @RequireAnyPermissions(
    'expenses.manage',
    'accountTransfers.manage',
    'incomes.manage',
    'movements.manage',
  )
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
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024, fieldSize: 2 * 1024 * 1024 },
    }),
  )
  importExcel(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('commit') commit?: string,
    @Query('kind') kind?: 'expense' | 'income' | 'transfer',
    @Query('modules') modules?: string,
    @Body('commit') commitBody?: string | boolean,
    @Body('accountMap') accountMapBody?: string,
    @Body('conceptMap') conceptMapBody?: string,
  ) {
    if (!file) throw new BadRequestException('Adjuntá el Excel (.xlsx)');
    const doCommit =
      commit === 'true' ||
      commit === '1' ||
      commitBody === true ||
      commitBody === 'true' ||
      commitBody === '1';
    const importKind =
      kind === 'expense' || kind === 'income' || kind === 'transfer' ? kind : undefined;
    const parsedModules = (modules ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((m): m is 'expense' | 'income' | 'transfer' =>
        m === 'expense' || m === 'income' || m === 'transfer',
      );
    let accountMap: Array<{ excelName: string; accountId?: string | null; create?: boolean }> | undefined;
    if (accountMapBody) {
      try {
        const parsed = JSON.parse(accountMapBody);
        if (Array.isArray(parsed)) accountMap = parsed;
      } catch {
        throw new BadRequestException('El mapa de cuentas no es válido');
      }
    }
    let conceptMap: Array<{ excelName: string; conceptId?: string | null; create?: boolean }> | undefined;
    if (conceptMapBody) {
      try {
        const parsed = JSON.parse(conceptMapBody);
        if (Array.isArray(parsed)) conceptMap = parsed;
      } catch {
        throw new BadRequestException('El mapa de conceptos no es válido');
      }
    }
    return doCommit
      ? this.excelImport.commit(user, shopId, file, importKind, parsedModules, accountMap, conceptMap)
      : this.excelImport.preview(user, shopId, file, importKind);
  }

  @Get(':id')
  @RequireAnyPermissions('expenses.read', 'accountTransfers.read', 'incomes.read', 'movements.read')
  one(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.movements.one(user, shopId, id);
  }

  @Post()
  @RequireAnyPermissions(
    'expenses.manage',
    'accountTransfers.manage',
    'incomes.manage',
    'movements.manage',
  )
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateMovementDto,
  ) {
    return this.movements.create(user, shopId, dto);
  }

  @Post(':id/receipt-file')
  @RequireAnyPermissions('expenses.manage', 'movements.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024, fieldSize: 2 * 1024 * 1024 },
    }),
  )
  uploadReceipt(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Archivo requerido');
    return this.movements.uploadReceiptFile(user, shopId, id, file);
  }

  @Get(':id/receipt-file')
  @RequireAnyPermissions('expenses.read', 'movements.read')
  async downloadReceipt(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, fileName, mime } = await this.movements.downloadReceiptFile(
      user,
      shopId,
      id,
    );
    res.setHeader('Content-Type', mime);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(fileName)}"`,
    );
    return stream;
  }

  @Patch(':id')
  @RequireAnyPermissions(
    'expenses.read',
    'expenses.manage',
    'accountTransfers.manage',
    'incomes.manage',
    'movements.manage',
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMovementDto,
  ) {
    return this.movements.update(user, shopId, id, dto);
  }

  @Delete(':id')
  @RequireAnyPermissions(
    'expenses.read',
    'expenses.manage',
    'accountTransfers.manage',
    'incomes.manage',
    'movements.manage',
  )
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: NotifyTargetsDto,
  ) {
    return this.movements.remove(user, shopId, id, dto);
  }
}
