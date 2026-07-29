import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;

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
}

export class UpdateShopDto extends PartialType(CreateShopDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
