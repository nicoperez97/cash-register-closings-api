import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { CurrentUser, Public, AuthUser } from '../../common/decorators';
import { ConfigService } from '@nestjs/config';

class FavoriteShopDto {
  @ApiPropertyOptional({ nullable: true, description: 'null para quitar el favorito' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  // Acepta UUIDs seed no RFC (p.ej. 22222222-2222-2222-2222-222222222222).
  @Matches(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)
  shopId?: string | null;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Get('google')
  googleConfig() {
    const clientId = (this.config.get<string>('google.clientId') || '').trim();
    return { enabled: !!clientId, clientId: clientId || null };
  }

  @Public()
  @Post('google')
  loginWithGoogle(@Body() dto: GoogleLoginDto) {
    return this.auth.loginWithGoogle(dto);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @Patch('favorite-shop')
  setFavoriteShop(@CurrentUser() user: AuthUser, @Body() dto: FavoriteShopDto) {
    return this.auth.setFavoriteShop(user.id, dto.shopId ?? null);
  }
}
