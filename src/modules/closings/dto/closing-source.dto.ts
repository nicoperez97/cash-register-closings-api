import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ClosingSourceKind } from '../../../common/enums';

export class UpsertShopClosingSourceDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateShopClosingSourceDto extends PartialType(UpsertShopClosingSourceDto) {}

export class ClosingSourceAmountDto {
  @ApiProperty()
  @IsUUID()
  sourceId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount: number;
}
