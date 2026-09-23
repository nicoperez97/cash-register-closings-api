import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ClosingSourceKind } from '../../../common/enums';
import { ToBoolean } from '../../../common/boolean.util';

export class SourcePosnetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;
}

export class SourcePosnetAmountDto {
  @ApiProperty()
  @IsString()
  posnetId: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount: number;
}

export class UpsertShopClosingSourceDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean() @IsBoolean()
  includeInDeclared?: boolean;

  @ApiPropertyOptional({ enum: ClosingSourceKind })
  @IsOptional()
  @IsEnum(ClosingSourceKind)
  kind?: ClosingSourceKind;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value ? value : null))
  @ValidateIf((_, v) => v != null)
  @IsUUID()
  accountId?: string | null;

  @ApiPropertyOptional({
    description: 'Días hasta acreditación esperada (solo SETTLE_CASH / SETTLE_ACCOUNT)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(90)
  settlementLagDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiPropertyOptional({ type: [SourcePosnetDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SourcePosnetDto)
  posnets?: SourcePosnetDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean() @IsBoolean()
  active?: boolean;
}

export class UpdateShopClosingSourceDto extends PartialType(UpsertShopClosingSourceDto) {}

export class ClosingSourceAmountDto {
  @ApiProperty()
  @IsUUID()
  sourceId: string;

  @ApiPropertyOptional({ description: 'Total; si hay lines o posnetAmounts, se usa la suma' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ type: [Number], description: 'Montos parciales; amount debe ser la suma' })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  lines?: number[];

  @ApiPropertyOptional({ type: [SourcePosnetAmountDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SourcePosnetAmountDto)
  posnetAmounts?: SourcePosnetAmountDto[];
}
