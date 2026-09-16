import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class OpenClosingDto {
  @ApiProperty({ description: 'Efectivo de apertura (cambio)' })
  @IsNumber()
  @Min(0)
  cashOpeningAmount: number;

  @ApiPropertyOptional({ description: 'Turno. Si no se envía, se usa el vigente.' })
  @IsOptional()
  @IsString()
  shiftId?: string | null;
}
