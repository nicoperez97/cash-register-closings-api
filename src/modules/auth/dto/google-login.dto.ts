import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({ description: 'ID token de Google Identity Services' })
  @IsString()
  @MinLength(20)
  idToken: string;
}
