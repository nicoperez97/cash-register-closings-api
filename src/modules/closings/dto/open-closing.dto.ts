import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class OpenClosingDto {
  @ApiPropertyOptional({
    description:
      'Efectivo de apertura (cambio). Si no se envía, se usa lo dejado en el cierre anterior o el cambio por defecto del local.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cashOpeningAmount?: number;

  @ApiPropertyOptional({
    description: 'Día laboral (YYYY-MM-DD). Si no se envía, se usa el día laboral actual del local.',
  })
  @IsOptional()
  @IsDateString()
  businessDate?: string;

  @ApiPropertyOptional({ description: 'Turno. Si no se envía, se usa el vigente para ese día.' })
  @IsOptional()
  @IsString()
  shiftId?: string | null;
}
