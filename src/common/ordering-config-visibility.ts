/** Qué bloques ve el usuario en Pedidos → pestaña Configurar (true = visible). */
export type OrderingConfigVisibilityKey =
  | 'caja'
  | 'channels'
  | 'payments'
  | 'items'
  | 'extras';

export type OrderingConfigVisibility = Record<OrderingConfigVisibilityKey, boolean>;

export const ORDERING_CONFIG_VISIBILITY_KEYS: OrderingConfigVisibilityKey[] = [
  'caja',
  'channels',
  'payments',
  'items',
  'extras',
];

export function defaultOrderingConfigVisibility(): OrderingConfigVisibility {
  return {
    caja: true,
    channels: true,
    payments: true,
    items: true,
    extras: true,
  };
}

/** Normaliza JSON parcial; defaults en true. */
export function normalizeOrderingConfigVisibility(
  raw?: Partial<OrderingConfigVisibility> | null,
): OrderingConfigVisibility {
  const base = defaultOrderingConfigVisibility();
  if (!raw || typeof raw !== 'object') return base;
  for (const key of ORDERING_CONFIG_VISIBILITY_KEYS) {
    if (raw[key] !== undefined) base[key] = !!raw[key];
  }
  return base;
}

export function mergeOrderingConfigVisibility(
  prev: OrderingConfigVisibility | null | undefined,
  patch?: Partial<OrderingConfigVisibility> | null,
): OrderingConfigVisibility {
  const base = normalizeOrderingConfigVisibility(prev);
  if (!patch || typeof patch !== 'object') return base;
  for (const key of ORDERING_CONFIG_VISIBILITY_KEYS) {
    if (patch[key] !== undefined) base[key] = !!patch[key];
  }
  return base;
}

export function canSeeOrderingConfig(
  visibility: OrderingConfigVisibility | null | undefined,
  key: OrderingConfigVisibilityKey,
): boolean {
  return normalizeOrderingConfigVisibility(visibility)[key] !== false;
}

export function hasAnyOrderingConfigSection(
  visibility: OrderingConfigVisibility | null | undefined,
): boolean {
  const v = normalizeOrderingConfigVisibility(visibility);
  return ORDERING_CONFIG_VISIBILITY_KEYS.some((k) => v[k]);
}
