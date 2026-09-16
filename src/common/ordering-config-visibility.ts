/** Nivel por bloque en Pedidos → Configurar. */
export type OrderingConfigLevel = 'none' | 'read' | 'manage';

export type OrderingConfigVisibilityKey =
  | 'caja'
  | 'channels'
  | 'payments'
  | 'items'
  | 'extras';

export type OrderingConfigVisibility = Record<OrderingConfigVisibilityKey, OrderingConfigLevel>;

export const ORDERING_CONFIG_VISIBILITY_KEYS: OrderingConfigVisibilityKey[] = [
  'caja',
  'channels',
  'payments',
  'items',
  'extras',
];

export const ORDERING_CONFIG_LEVELS: Array<{
  value: OrderingConfigLevel;
  label: string;
  short: string;
}> = [
  { value: 'none', label: 'Ninguno', short: 'Off' },
  { value: 'read', label: 'Ver', short: 'Ver' },
  { value: 'manage', label: 'Gestionar', short: 'Todo' },
];

export function defaultOrderingConfigVisibility(): OrderingConfigVisibility {
  return {
    caja: 'manage',
    channels: 'manage',
    payments: 'manage',
    items: 'manage',
    extras: 'manage',
  };
}

function coerceOrderingConfigLevel(raw: unknown): OrderingConfigLevel {
  if (raw === true || raw === 'manage' || raw === 'todo' || raw === 'all') return 'manage';
  if (raw === 'read' || raw === 'ver' || raw === 'view') return 'read';
  if (raw === false || raw === 'none' || raw === 'off') return 'none';
  if (raw === 'manage' || raw === 'read' || raw === 'none') return raw;
  return 'manage';
}

/** Normaliza JSON parcial o legado boolean; default manage. */
export function normalizeOrderingConfigVisibility(
  raw?: Partial<Record<OrderingConfigVisibilityKey, unknown>> | null,
): OrderingConfigVisibility {
  const base = defaultOrderingConfigVisibility();
  if (!raw || typeof raw !== 'object') return base;
  for (const key of ORDERING_CONFIG_VISIBILITY_KEYS) {
    if (raw[key] !== undefined) base[key] = coerceOrderingConfigLevel(raw[key]);
  }
  return base;
}

export function mergeOrderingConfigVisibility(
  prev: OrderingConfigVisibility | null | undefined,
  patch?: Partial<Record<OrderingConfigVisibilityKey, unknown>> | null,
): OrderingConfigVisibility {
  const base = normalizeOrderingConfigVisibility(prev);
  if (!patch || typeof patch !== 'object') return base;
  for (const key of ORDERING_CONFIG_VISIBILITY_KEYS) {
    if (patch[key] !== undefined) base[key] = coerceOrderingConfigLevel(patch[key]);
  }
  return base;
}

export function orderingConfigLevelOf(
  visibility: OrderingConfigVisibility | null | undefined,
  key: OrderingConfigVisibilityKey,
): OrderingConfigLevel {
  return normalizeOrderingConfigVisibility(visibility)[key];
}

export function canSeeOrderingConfig(
  visibility: OrderingConfigVisibility | null | undefined,
  key: OrderingConfigVisibilityKey,
): boolean {
  return orderingConfigLevelOf(visibility, key) !== 'none';
}

export function canEditOrderingConfig(
  visibility: OrderingConfigVisibility | null | undefined,
  key: OrderingConfigVisibilityKey,
): boolean {
  return orderingConfigLevelOf(visibility, key) === 'manage';
}

export function hasAnyOrderingConfigSection(
  visibility: OrderingConfigVisibility | null | undefined,
): boolean {
  const v = normalizeOrderingConfigVisibility(visibility);
  return ORDERING_CONFIG_VISIBILITY_KEYS.some((k) => v[k] !== 'none');
}
