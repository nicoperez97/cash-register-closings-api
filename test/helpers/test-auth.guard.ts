import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TEST_AUTH_USERS, type TestAuthRole } from '../fixtures/auth-users';

/**
 * Sustituye JWT en e2e: `Authorization: Bearer test:cashier|receptionist|admin`
 */
@Injectable()
export class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const auth = String(req.headers.authorization ?? '');
    const match = auth.match(/^Bearer test:(cashier|receptionist|admin)$/);
    if (!match) {
      throw new UnauthorizedException('Token de prueba inválido');
    }
    const role = match[1] as TestAuthRole;
    const factory = TEST_AUTH_USERS[role];
    if (!factory) {
      throw new UnauthorizedException('Rol de prueba desconocido');
    }
    req.user = factory();
    return true;
  }
}
