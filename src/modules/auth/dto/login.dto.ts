import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'usuario@empresa.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '********' })
  @IsString()
  @MinLength(4)
  password: string;
}
