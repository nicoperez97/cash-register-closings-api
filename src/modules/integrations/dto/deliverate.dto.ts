import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ClosingSourceKind } from '../../../common/enums';

export class DeliverateWorkingDayDto {
  @ApiProperty({ description: '0=domingo … 6=sábado' })
  @Type(() => Number)
  @IsNumber()
  day: number;

  @ApiProperty({ type: [String], example: ['M', 'N'] })
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['M', 'N'], { each: true })
  shifts: Array<'M' | 'N'>;
}

export class UpsertDeliverateConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  username?: string | null;

  @ApiPropertyOptional({ description: 'Omitir para no cambiar' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  password?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  integrationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  shopPassword?: string | null;

  @ApiPropertyOptional({ enum: ['La Plata', 'Gonnet', 'City Bell'] })
  @IsOptional()
  @IsIn(['La Plata', 'Gonnet', 'City Bell'])
  shopZone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  businessName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cuit?: string | null;

  @ApiPropertyOptional({ enum: ['fisica', 'juridica'] })
  @IsOptional()
  @IsIn(['fisica', 'juridica'])
  taxType?: string | null;

  @ApiPropertyOptional({ enum: ['RI', 'RM'] })
  @IsOptional()
  @IsIn(['RI', 'RM'])
  ivaCondition?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  gender?: string | null;

  @ApiPropertyOptional({ example: '07/08/2007' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  birthDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ownerName?: string | null;

  @ApiPropertyOptional({ description: 'Dirección del local (text_address Deliverate)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  textAddress?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  cellphone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  telephone?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  emails?: string[] | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  locationLat?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  locationLng?: number | null;

  @ApiPropertyOptional({ type: [DeliverateWorkingDayDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliverateWorkingDayDto)
  workingDays?: DeliverateWorkingDayDto[] | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  testMode?: boolean;

  /**
   * Origen público de la API de este local (sin / final).
   * Ej. https://api.midominio.com
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  webhookBaseUrl?: string | null;

  /** Si true: authenticate + upsertApiKey (webhook). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  connect?: boolean;

  /** Si true: createIntegrationShop en Deliverate. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  createShop?: boolean;

  /** Cuenta del local para el cierre (fuentes extra). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  closingAccountId?: string | null;

  @ApiPropertyOptional({ enum: ClosingSourceKind })
  @IsOptional()
  @IsEnum(ClosingSourceKind)
  closingKind?: ClosingSourceKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  closingIncludeInDeclared?: boolean;

  /** Medio de pago de pedidos que impactan en la fuente Deliverate del cierre. */
  @ApiPropertyOptional({ enum: ['CASH', 'TRANSFER'] })
  @IsOptional()
  @IsIn(['CASH', 'TRANSFER'])
  closingPaymentMethod?: 'CASH' | 'TRANSFER';
}

export class DeliverateWebhookDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  action: string;

  @ApiProperty()
  @IsOptional()
  @IsObject()
  update?: Record<string, unknown>;
}
