import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@cierres.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'demo' })
  @IsString()
  @MinLength(4)
  password: string;
}
