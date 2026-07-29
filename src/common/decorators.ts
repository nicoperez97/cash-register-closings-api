import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Permission } from './enums';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  globalRole: string;
  shopIds: string[];
  /** Rol efectivo por local (shopRole o globalRole). */
  shopRoles: Record<string, string>;
  /** Cuentas contables asociadas por local (N:N). */
  shopAccountIds: Record<string, string[]>;
  permissions: Permission[];
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
