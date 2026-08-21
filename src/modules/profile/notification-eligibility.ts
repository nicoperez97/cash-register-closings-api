import { GlobalRole, NotificationType, NOTIFICATION_TYPE_LABELS } from '../../common/enums';
import { UserShop } from '../../entities/user-shop.entity';

const SHOP_ADMIN_ROLES = new Set([GlobalRole.OWNER, GlobalRole.ADMIN]);

/** Tipos que reciben OWNER/ADMIN del local (y super admin). */
export const ADMIN_RECIPIENT_TYPES: NotificationType[] = [
  NotificationType.PAYMENT_VALIDATE,
  NotificationType.PAYMENT_PAY,
  NotificationType.PAYMENT_REJECTED,
  NotificationType.PAYMENT_PAID,
  NotificationType.CLOSING_CREATED,
  NotificationType.CASH_WITHDRAWAL_PICKED,
  NotificationType.PRODUCTION_HOURS_LOGGED,
  NotificationType.MOVEMENT_CREATED,
  NotificationType.REIMBURSEMENT_CREATED,
];

const STOCK_TYPES: NotificationType[] = [
  NotificationType.STOCK_BELOW_MINIMUM,
  NotificationType.STOCK_SHARED,
];

const BEVERAGE_TYPES: NotificationType[] = [
  NotificationType.BEVERAGE_STOCK_BELOW_MINIMUM,
  NotificationType.BEVERAGE_STOCK_SHARED,
];

const SHORTAGE_TYPES: NotificationType[] = [
  NotificationType.SHORTAGE_CREATED,
  NotificationType.SHORTAGE_LEVEL_LOW,
  NotificationType.SHORTAGE_RESOLVED,
];

const RESERVATION_TYPES: NotificationType[] = [NotificationType.RESERVATION_REQUEST];

export function eligibleNotificationTypes(opts: {
  link: UserShop | null | undefined;
  globalRole: string | GlobalRole;
}): NotificationType[] {
  const set = new Set<NotificationType>();
  const link = opts.link;
  const globalRole = opts.globalRole as GlobalRole;
  const shopRole = (link?.shopRole ?? globalRole) as GlobalRole;

  if (
    globalRole === GlobalRole.OWNER ||
    SHOP_ADMIN_ROLES.has(shopRole)
  ) {
    for (const t of ADMIN_RECIPIENT_TYPES) set.add(t);
  }
  if (link?.isStockAdmin) {
    for (const t of STOCK_TYPES) set.add(t);
  }
  if (link?.isBeverageStockAdmin) {
    for (const t of BEVERAGE_TYPES) set.add(t);
  }
  if (link?.isShortageAdmin) {
    for (const t of SHORTAGE_TYPES) set.add(t);
  }
  if (link?.isReservationAdmin) {
    for (const t of RESERVATION_TYPES) set.add(t);
  }

  return [...set];
}

export function mutedSet(link: UserShop | null | undefined): Set<string> {
  const raw = link?.mutedNotificationTypes;
  if (!Array.isArray(raw) || !raw.length) return new Set();
  return new Set(raw.map((t) => String(t).trim()).filter(Boolean));
}

export function isNotificationMuted(
  link: UserShop | null | undefined,
  type: string,
): boolean {
  return mutedSet(link).has(String(type));
}

export function eligibleNotificationsPayload(opts: {
  link: UserShop | null | undefined;
  globalRole: string | GlobalRole;
}): Array<{ type: NotificationType; label: string; muted: boolean }> {
  const muted = mutedSet(opts.link);
  return eligibleNotificationTypes(opts).map((type) => ({
    type,
    label: NOTIFICATION_TYPE_LABELS[type] ?? type,
    muted: muted.has(type),
  }));
}
