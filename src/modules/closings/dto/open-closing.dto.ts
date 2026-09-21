import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'Turno. Si no se envía, se usa el vigente.' })
  @IsOptional()
  @IsString()
  shiftId?: string | null;
}
