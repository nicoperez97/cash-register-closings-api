import {
  BadRequestException,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export type DineInAuthPayload = {
  typ: 'dine_in';
  shopId: string;
  slug: string;
  tableSessionId: string;
  salonTableId: string;
};

export const CurrentDineIn = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DineInAuthPayload => {
    const req = ctx.switchToHttp().getRequest();
    return req.dineIn as DineInAuthPayload;
  },
);

@Injectable()
export class DineInAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header = String(req.headers?.authorization ?? '');
    const token = header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : '';
    if (!token) throw new UnauthorizedException('Sesión de mesa requerida');
    try {
      const payload = this.jwt.verify(token) as DineInAuthPayload;
      if (
        payload?.typ !== 'dine_in' ||
        !payload.shopId ||
        !payload.tableSessionId ||
        !payload.salonTableId
      ) {
        throw new UnauthorizedException('Token inválido');
      }
      req.dineIn = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Sesión de mesa inválida o vencida');
    }
  }
}

export function assertDineInShopSlug(guest: DineInAuthPayload, slug: string) {
  if (guest.slug !== slug) {
    throw new BadRequestException('Local incorrecto para esta sesión');
  }
}
