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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { PaymentsService } from './payments.service';

class CreatePaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsNumber()
  @Min(0)
  amount?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsDateString()
  dueDate?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  payerUserId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  validatorUserId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  accountId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  supplierId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  employeeId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceLegalName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceTaxId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceType?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceNumber?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsNumber()
  @Min(0)
  invoiceNetAmount?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsNumber()
  @Min(0)
  invoiceIvaAmount?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsNumber()
  @Min(0)
  invoicePerceptionsAmount?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsNumber()
  @Min(0)
  invoiceOtherTaxesAmount?: number | null;
}

class UpdatePaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsNumber()
  @Min(0)
  amount?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsDateString()
  dueDate?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsDateString()
  paidAt?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  payerUserId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  validatorUserId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  accountId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  supplierId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  employeeId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceLegalName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceTaxId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceType?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() invoiceNumber?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsNumber()
  @Min(0)
  invoiceNetAmount?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsNumber()
  @Min(0)
  invoiceIvaAmount?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsNumber()
  @Min(0)
  invoicePerceptionsAmount?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsNumber()
  @Min(0)
  invoiceOtherTaxesAmount?: number | null;
}

class PayPaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() paidAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
}

class RejectPaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

class ResendPaymentNotificationDto {
  @ApiProperty({ enum: ['VALIDATE', 'PAY'] })
  @IsIn(['VALIDATE', 'PAY'])
  kind: 'VALIDATE' | 'PAY';
}

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions('payments.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('status') status?: string,
    @Query('payerUserId') payerUserId?: string,
    @Query('validatorUserId') validatorUserId?: string,
    @Query('mine') mine?: string,
    @Query('dueFrom') dueFrom?: string,
    @Query('dueTo') dueTo?: string,
    @Query('paidFrom') paidFrom?: string,
    @Query('paidTo') paidTo?: string,
    @Query('supplierId') supplierId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('amountMin') amountMin?: string,
    @Query('amountMax') amountMax?: string,
  ) {
    const mineUserId =
      mine === '1' || mine === 'true' ? user.id : undefined;
    return this.payments.list(user, shopId, {
      status,
      payerUserId,
      validatorUserId,
      mineUserId,
      dueFrom,
      dueTo,
      paidFrom,
      paidTo,
      supplierId,
      employeeId,
      amountMin,
      amountMax,
    });
  }

  @Get('export.xlsx')
  @RequirePermissions('payments.read')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('status') status: string | undefined,
    @Query('kind') kind: string | undefined,
    @Query('payerUserId') payerUserId: string | undefined,
    @Query('validatorUserId') validatorUserId: string | undefined,
    @Query('mine') mine: string | undefined,
    @Query('dueFrom') dueFrom: string | undefined,
    @Query('dueTo') dueTo: string | undefined,
    @Query('paidFrom') paidFrom: string | undefined,
    @Query('paidTo') paidTo: string | undefined,
    @Query('supplierId') supplierId: string | undefined,
    @Query('employeeId') employeeId: string | undefined,
    @Query('amountMin') amountMin: string | undefined,
    @Query('amountMax') amountMax: string | undefined,
    @Res() res: Response,
  ) {
    const mineUserId =
      mine === '1' || mine === 'true' ? user.id : undefined;
    const { buffer, filename } = await this.payments.exportExcel(user, shopId, {
      status,
      kind,
      payerUserId,
      validatorUserId,
      mineUserId,
      dueFrom,
      dueTo,
      paidFrom,
      paidTo,
      supplierId,
      employeeId,
      amountMin,
      amountMax,
    });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post('parse-invoice')
  @RequirePermissions('payments.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  parseInvoice(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Archivo requerido');
    return this.payments.parseInvoice(user, shopId, file);
  }

  @Get(':id')
  @RequirePermissions('payments.read')
  one(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.payments.one(user, shopId, id);
  }

  @Post()
  @RequirePermissions('payments.manage')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.payments.create(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('payments.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.payments.update(user, shopId, id, dto);
  }

  @Post(':id/invoice-file')
  @RequirePermissions('payments.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        applyParsed: { type: 'string', description: '1/true para rellenar desde OCR' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  uploadInvoice(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('applyParsed') applyParsed?: string,
  ) {
    if (!file) throw new BadRequestException('Archivo requerido');
    const apply = applyParsed !== '0' && applyParsed !== 'false';
    return this.payments.uploadInvoiceFile(user, shopId, id, file, apply);
  }

  @Get(':id/invoice-file')
  @RequirePermissions('payments.read')
  async downloadInvoice(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, fileName, mime } = await this.payments.downloadInvoiceFile(
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

  @Post(':id/receipt-file')
  @RequirePermissions('payments.read')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  uploadReceipt(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Archivo requerido');
    return this.payments.uploadReceiptFile(user, shopId, id, file);
  }

  @Get(':id/receipt-file')
  @RequirePermissions('payments.read')
  async downloadReceipt(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, fileName, mime } = await this.payments.downloadReceiptFile(
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

  @Post(':id/validate')
  @RequirePermissions('payments.read')
  validate(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.payments.validate(user, shopId, id);
  }

  @Post(':id/reject')
  @RequirePermissions('payments.read')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: RejectPaymentDto,
  ) {
    return this.payments.reject(user, shopId, id, dto.reason);
  }

  @Post(':id/pay')
  @RequirePermissions('payments.read')
  pay(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: PayPaymentDto,
  ) {
    return this.payments.pay(user, shopId, id, dto);
  }

  @Post(':id/resend-notification')
  @RequirePermissions('payments.manage')
  resendNotification(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: ResendPaymentNotificationDto,
  ) {
    return this.payments.resendNotification(user, shopId, id, dto.kind);
  }

  @Post(':id/cancel')
  @RequirePermissions('payments.manage')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.payments.cancel(user, shopId, id);
  }

  @Delete(':id')
  @RequirePermissions('payments.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.payments.remove(user, shopId, id);
  }
}
