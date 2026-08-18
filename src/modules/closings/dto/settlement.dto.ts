import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class SettleClosingSourcesDto {
  @ApiProperty({ type: [String], description: 'IDs de montos a rendir (closing_source_amounts)' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids: string[];

  @ApiProperty({ description: 'Cuenta destino del ingreso' })
  @IsUUID()
  accountId: string;
}
