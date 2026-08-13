import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
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

  @ApiPropertyOptional({ description: 'Habilita el módulo de reservas en este local' })
  @IsOptional()
  @IsBoolean()
  reservationsEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Habilita el formulario público de reservas' })
  @IsOptional()
  @IsBoolean()
  reservationSignupEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Habilita reservas en el sector adentro' })
  @IsOptional()
  @IsBoolean()
  reservationInsideEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Habilita reservas en el sector afuera' })
  @IsOptional()
  @IsBoolean()
  reservationOutsideEnabled?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Máximo de personas adentro. NULL = sin tope.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  reservationInsideMaxPartySize?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'A partir de cuántas personas la mesa es sí o sí afuera. NULL = sin regla.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  reservationOutsideMinPartySize?: number | null;

  @ApiPropertyOptional({ description: 'Habilita el módulo de lista de espera en este local' })
  @IsOptional()
  @IsBoolean()
  waitingListEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Habilita el módulo de propinas en este local' })
  @IsOptional()
  @IsBoolean()
  tipsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  defaultChangeAmount?: number;

  @ApiPropertyOptional({
    example: 8,
    description: 'Horas por defecto al marcar asistencia en producción',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  productionDefaultHours?: number;

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

  @ApiPropertyOptional({
    type: [Number],
    example: [0, 1],
    description: 'Días de franco (0=domingo … 6=sábado)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  closedWeekdays?: number[] | null;

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

  @ApiPropertyOptional({ example: '#F9A825', description: 'Color de énfasis / secundario' })
  @IsOptional()
  @IsString()
  accentSecondary?: string;

  @ApiPropertyOptional({
    example: 'local@restaurante.com',
    description: 'Email del local (remitente y usuario SMTP, p.ej. Gmail)',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional({
    example: 'tuttopassa',
    description: 'Usuario de Instagram del local (sin @)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  instagramHandle?: string | null;

  @ApiPropertyOptional({
    example: '+598 99 123 456',
    description: 'Teléfono del local con código de país (WhatsApp a futuro)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({
    description:
      'Contraseña SMTP / de aplicación del email del local. Omitir o "" = no cambiar; null = borrar',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsString()
  @MinLength(4)
  emailSmtpPassword?: string | null;

  @ApiPropertyOptional({ description: 'Si es false, no se envían mails de este local' })
  @IsOptional()
  @IsBoolean()
  emailNotificationsEnabled?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Tipos de notificación a enviar por mail. null = todos',
    nullable: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emailNotificationTypes?: string[] | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'IDs de usuarios del local que reciben mails. null = todos',
    nullable: true,
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  emailNotificationUserIds?: string[] | null;

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
