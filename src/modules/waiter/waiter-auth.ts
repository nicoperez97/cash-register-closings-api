import {
  BadRequestException,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export type WaiterAuthPayload = {
  typ: 'waiter';
  shopId: string;
  employeeId: string;
  slug: string;
  name: string;
};

export const CurrentWaiter = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WaiterAuthPayload => {
    const req = ctx.switchToHttp().getRequest();
    return req.waiter as WaiterAuthPayload;
  },
);

@Injectable()
export class WaiterAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header = String(req.headers?.authorization ?? '');
    const token = header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : '';
    if (!token) throw new UnauthorizedException('Sesión de mozo requerida');
    try {
      const payload = this.jwt.verify(token) as WaiterAuthPayload;
      if (payload?.typ !== 'waiter' || !payload.shopId || !payload.employeeId) {
        throw new UnauthorizedException('Token inválido');
      }
      req.waiter = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Sesión de mozo inválida o vencida');
    }
  }
}

export function assertWaiterShopSlug(waiter: WaiterAuthPayload, slug: string) {
  if (waiter.slug !== slug) {
    throw new BadRequestException('Local incorrecto para esta sesión');
  }
}
