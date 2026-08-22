import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** Destinatarios opcionales al editar o borrar un gasto/pago. */
export class NotifyTargetsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyAdmins?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  notifyUserIds?: string[];
}
