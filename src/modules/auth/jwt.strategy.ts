import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('access_token'),
      ]),
      secretOrKey: config.get<string>('api.secret') ?? 'change-me-crc-dev',
    });
  }

  async validate(payload: { sub?: unknown; typ?: unknown; isDemo?: boolean }) {
    // Mozo / mesa firman con el mismo secreto pero sin `sub`: no son sesiones de usuario.
    if (payload?.typ !== undefined || typeof payload?.sub !== 'string' || !payload.sub.trim()) {
      throw new UnauthorizedException('Token inválido');
    }
    const user = await this.auth.buildAuthUser(payload.sub);
    return { ...user, isDemo: !!payload.isDemo };
  }
}
