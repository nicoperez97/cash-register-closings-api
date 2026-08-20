import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ClosingStatus, ExpenseCategory, ExtraLineType } from '../../../common/enums';
import { ClosingSourceAmountDto } from './closing-source.dto';
import { PosnetType } from '../../../common/posnet';

export class ExpenseDto {
  @ApiProperty()
  @IsString()
  label: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ enum: ExpenseCategory })
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @ApiPropertyOptional({ description: 'Concepto de catálogo (categoría Cierre)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsUUID()
  conceptId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class ExtraLineDto {
  @ApiProperty({ enum: ExtraLineType })
  @IsEnum(ExtraLineType)
  type: ExtraLineType;

  @ApiProperty()
  @IsString()
  label: string;

  @ApiProperty()
  @IsNumber()
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  meta?: string;
}

export class ClosingPosnetAmountDto {
  @ApiProperty()
  @IsString()
  posnetId: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: PosnetType })
  @IsEnum(PosnetType)
  type: PosnetType;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount: number;
}

export class CreateClosingDto {
  @ApiProperty({ example: '2026-07-25' })
  @IsDateString()
  businessDate: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) posSystemAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) cardAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) cashAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) mercadoPagoAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) deliveryAppsAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) transferAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) accountDniAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) otherAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() unitsSold?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() coversCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() averageTicket?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) cashLeftInRegister?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) cashPendingPickup?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) cashWithdrawn?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashWithdrawnByUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashWithdrawnByEmployeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cashWithdrawnByName?: string;
  @ApiPropertyOptional({
    description:
      'Cuenta destino del retiro. Obligatoria si el usuario tiene más de una cuenta asociada.',
  })
  @IsOptional()
  @IsUUID()
  cashWithdrawnToAccountId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) tipsAmount?: number;
  @ApiPropertyOptional({ description: 'Desglose propinas: efectivo' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tipCashAmount?: number;
  @ApiPropertyOptional({ description: 'Desglose propinas: transferencia' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tipTransferAmount?: number;
  @ApiPropertyOptional({ description: 'Desglose propinas: tickets' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tipTicketsAmount?: number;
  @ApiPropertyOptional({
    type: [Number],
    description: 'Desglose propinas: recibos individuales',
  })
  @IsOptional()
  @IsArray()
  tipReceipts?: number[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipNotes?: string | null;
  @ApiPropertyOptional({
    type: 'array',
    description: 'Reparto de propinas por empleado',
  })
  @IsOptional()
  @IsArray()
  tipAllocations?: Array<{ employeeId: string; amount: number; delivered?: boolean }>;
  @ApiPropertyOptional() @IsOptional() @IsNumber() declaredTotal?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() differenceReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() evidenceUrl?: string;
  @ApiPropertyOptional({ enum: ClosingStatus })
  @IsOptional()
  @IsEnum(ClosingStatus)
  status?: ClosingStatus;

  @ApiPropertyOptional({ type: [ExpenseDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpenseDto)
  expenses?: ExpenseDto[];

  @ApiPropertyOptional({ type: [ExtraLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraLineDto)
  extraLines?: ExtraLineDto[];

  @ApiPropertyOptional({
    type: [ClosingPosnetAmountDto],
    description: 'Si se envía, PVS / Mercado Pago / Cuenta DNI se recalculan como suma por tipo',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClosingPosnetAmountDto)
  posnetAmounts?: ClosingPosnetAmountDto[] | null;

  @ApiPropertyOptional({
    type: [ClosingSourceAmountDto],
    description: 'Montos de fuentes extra del local (Pedidos Ya, delivery, etc.)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClosingSourceAmountDto)
  sourceAmounts?: ClosingSourceAmountDto[];
}

export class UpdateClosingDto extends PartialType(CreateClosingDto) {}
