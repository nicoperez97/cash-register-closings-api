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
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ClosingStatus, ExpenseCategory, ExtraLineType } from '../../../common/enums';

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
  @ApiPropertyOptional() @IsOptional() @IsString() cashWithdrawnByName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) tipsAmount?: number;
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
}

export class UpdateClosingDto extends PartialType(CreateClosingDto) {}
