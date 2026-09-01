import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AuthUser, IS_PUBLIC_KEY, MANAGE_USERS_KEY, PERMISSIONS_ANY_KEY, PERMISSIONS_KEY } from './decorators';
import { GlobalRole, Permission, ROLE_PERMISSIONS } from './enums';

const SHOP_ADMIN_ROLES = new Set<GlobalRole>([GlobalRole.OWNER, GlobalRole.ADMIN]);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const manageUsers = this.reflector.getAllAndOverride<boolean>(MANAGE_USERS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (manageUsers) {
      const req = context.switchToHttp().getRequest();
      const user = req.user as AuthUser | undefined;
      if (!user) throw new UnauthorizedException();
      if (!canManageUsersSomewhere(user)) {
        throw new ForbiddenException('Sin permiso para gestionar usuarios');
      }
      return true;
    }

    const requiredAny = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_ANY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredAny?.length) {
      const req = context.switchToHttp().getRequest();
      const user = req.user as AuthUser | undefined;
      if (!user) throw new UnauthorizedException();
      const shopId = extractShopId(req);
      const perms = resolveUserPermissions(user, shopId);
      const ok = requiredAny.some((p) => perms.includes(p));
      if (!ok) throw new ForbiddenException('Sin permiso');
      return true;
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user) throw new UnauthorizedException();

    const shopId = extractShopId(req);
    const perms = resolveUserPermissions(user, shopId);
    const ok = required.every((p) => perms.includes(p));
    if (!ok) throw new ForbiddenException('Sin permiso');
    return true;
  }
}

function extractShopId(req: {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}): string | null {
  const fromParams = req.params?.shopId;
  if (fromParams) return fromParams;
  const fromQuery = req.query?.shopId;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
  const bodyShop = req.body?.shopId;
  if (typeof bodyShop === 'string' && bodyShop) return bodyShop;
  return null;
}

/** Permisos efectivos para un local (o unión si no hay shopId). */
export function resolveUserPermissions(
  user: AuthUser,
  shopId?: string | null,
): Permission[] {
  if (isGlobalAdmin(user.globalRole as GlobalRole)) {
    return user.permissions?.length ? user.permissions : [...(ROLE_PERMISSIONS[GlobalRole.OWNER] ?? [])];
  }
  if (shopId && user.shopPermissions && Object.prototype.hasOwnProperty.call(user.shopPermissions, shopId)) {
    return user.shopPermissions[shopId];
  }
  if (shopId) {
    // sin mapa para ese shop → denegar
    return [];
  }
  // sin shopId: unión de todos los shops del usuario
  const set = new Set<Permission>();
  for (const list of Object.values(user.shopPermissions ?? {})) {
    for (const p of list) set.add(p);
  }
  if (set.size) return [...set];
  return user.permissions ?? [];
}

export function resolvePermissions(role: GlobalRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function isGlobalAdmin(role: GlobalRole | string): boolean {
  return role === GlobalRole.OWNER || role === GlobalRole.ADMIN;
}

/** Solo Super admin (OWNER). */
export function isSuperAdmin(role: GlobalRole | string): boolean {
  return role === GlobalRole.OWNER;
}

/** Editar/borrar gastos: super admin o usuario habilitado en ese local. */
export function canEditExpenses(user: AuthUser, shopId: string): boolean {
  if (isSuperAdmin(user.globalRole)) return true;
  return !!user.shopCanEditExpenses?.[shopId];
}

/** Editar/borrar pagos: super admin o usuario habilitado en ese local. */
export function canEditPayments(user: AuthUser, shopId: string): boolean {
  if (isSuperAdmin(user.globalRole)) return true;
  return !!user.shopCanEditPayments?.[shopId];
}

/** Saldos iniciales de cuentas: solo super admin. */
export function canConfigureOpeningBalances(user: AuthUser): boolean {
  return isSuperAdmin(user.globalRole);
}

/** Admin global, permiso users.manage, o admin/owner del local. */
export function canManageUsersSomewhere(user: AuthUser): boolean {
  if (isGlobalAdmin(user.globalRole as GlobalRole)) return true;
  if (user.permissions.includes('users.manage')) return true;
  return user.shopIds.some((id) => {
    if (user.shopPermissions?.[id]?.includes('users.manage')) return true;
    const role = (user.shopRoles?.[id] ?? user.globalRole) as GlobalRole;
    return SHOP_ADMIN_ROLES.has(role);
  });
}
