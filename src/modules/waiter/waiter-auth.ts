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
  /** PIN público /mozo o personal de backoffice (Operación → Comanda). */
  typ: 'waiter' | 'waiter_staff';
  shopId: string;
  /** Vacío permitido en waiter_staff si el usuario no tiene empleado vinculado. */
  employeeId: string;
  slug: string;
  name: string;
};

export function waiterEmployeeIdOrNull(waiter: WaiterAuthPayload): string | null {
  const id = String(waiter.employeeId ?? '').trim();
  return id || null;
}

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
      const pinOk =
        payload?.typ === 'waiter' && !!payload.shopId && !!payload.employeeId;
      const staffOk =
        payload?.typ === 'waiter_staff' && !!payload.shopId && !!payload.slug;
      if (!pinOk && !staffOk) {
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
