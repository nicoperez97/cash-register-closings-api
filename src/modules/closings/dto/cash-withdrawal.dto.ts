import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class PickCashWithdrawalsDto {
  @ApiProperty({ type: [String], description: 'IDs de retiros pendientes' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids: string[];

  @ApiProperty({ description: 'Usuario que se lleva el efectivo' })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({ description: 'Cuenta destino (obligatoria si el usuario tiene varias)' })
  @IsOptional()
  @IsString()
  accountId?: string | null;
}
