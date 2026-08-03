import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PosnetType } from '../../../common/posnet';

export class ShopPosnetDto {
  @ApiPropertyOptional({ description: 'Si no se envía, el servidor genera uno' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Posnet caja 1' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ enum: PosnetType })
  @IsEnum(PosnetType)
  type: PosnetType;
}

export class CreateShopDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  slug: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unitsLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  coversEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  defaultChangeAmount?: number;

  @ApiPropertyOptional({ example: 'America/Argentina/Buenos_Aires' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({
    example: '10:00',
    description: 'Hora de apertura (HH:mm). El día laboral dura hasta esa hora del día siguiente.',
  })
  @IsOptional()
  @IsString()
  openingTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    example: 'https://drive.google.com/file/d/FILE_ID/view?usp=sharing',
    description: 'Acepta vínculo de Drive; se normaliza a URL de imagen.',
  })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ example: '#E65100' })
  @IsOptional()
  @IsString()
  accentColor?: string;

  @ApiPropertyOptional({ description: 'Sistema de ventas / POS (Restosoft, etc.)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  salesSystemId?: string | null;

  @ApiPropertyOptional({
    description: 'Mapa código FormaDePago → cash|card|mercadoPago|delivery|transfer|accountDni|other',
  })
  @IsOptional()
  @IsObject()
  posPaymentMap?: Record<string, string> | null;

  @ApiPropertyOptional({ type: [ShopPosnetDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShopPosnetDto)
  posnets?: ShopPosnetDto[] | null;
}

export class UpdateShopDto extends PartialType(CreateShopDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
