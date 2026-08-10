/** Dónde se muestra un usuario del local (true = visible). */
export type UserVisibilityKey =
  | 'cashWithdraw'
  | 'closingsFilters'
  | 'payments'
  | 'movements'
  | 'employeeLink'
  | 'usersList';

export type UserVisibility = Record<UserVisibilityKey, boolean>;

export const USER_VISIBILITY_KEYS: UserVisibilityKey[] = [
  'cashWithdraw',
  'closingsFilters',
  'payments',
  'movements',
  'employeeLink',
  'usersList',
];

export function defaultUserVisibility(): UserVisibility {
  return {
    cashWithdraw: true,
    closingsFilters: true,
    payments: true,
    movements: true,
    employeeLink: true,
    usersList: true,
  };
}

/** Normaliza JSON parcial / legacy; defaults en true. */
export function normalizeUserVisibility(
  raw?: Partial<UserVisibility> | null,
  opts?: { hideFromCashWithdraw?: boolean },
): UserVisibility {
  const base = defaultUserVisibility();
  if (opts?.hideFromCashWithdraw) {
    base.cashWithdraw = false;
  }
  if (!raw || typeof raw !== 'object') return base;
  for (const key of USER_VISIBILITY_KEYS) {
    if (raw[key] !== undefined) {
      base[key] = !!raw[key];
    }
  }
  return base;
}

export function mergeUserVisibility(
  prev: UserVisibility | null | undefined,
  patch?: Partial<UserVisibility> | null,
): UserVisibility {
  const base = normalizeUserVisibility(prev);
  if (!patch || typeof patch !== 'object') return base;
  for (const key of USER_VISIBILITY_KEYS) {
    if (patch[key] !== undefined) {
      base[key] = !!patch[key];
    }
  }
  return base;
}

export function isUserVisibleIn(
  visibility: UserVisibility | null | undefined,
  key: UserVisibilityKey,
): boolean {
  return normalizeUserVisibility(visibility)[key] !== false;
}
