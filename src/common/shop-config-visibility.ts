/** Nivel por sección de Configuración del local. */
export type ShopConfigLevel = 'none' | 'read' | 'manage';

export type ShopConfigVisibilityKey =
  | 'resumen'
  | 'identidad'
  | 'operacion'
  | 'pedidos'
  | 'comanda'
  | 'comanderas'
  | 'dispositivos'
  | 'menu'
  | 'carta'
  | 'avanzado';

export type ShopConfigVisibility = Record<ShopConfigVisibilityKey, ShopConfigLevel>;

export const SHOP_CONFIG_VISIBILITY_KEYS: ShopConfigVisibilityKey[] = [
  'resumen',
  'identidad',
  'operacion',
  'pedidos',
  'comanda',
  'comanderas',
  'dispositivos',
  'menu',
  'carta',
  'avanzado',
];

export const SHOP_CONFIG_LEVELS: Array<{
  value: ShopConfigLevel;
  label: string;
  short: string;
}> = [
  { value: 'none', label: 'Ninguno', short: 'Off' },
  { value: 'read', label: 'Ver', short: 'Ver' },
  { value: 'manage', label: 'Gestionar', short: 'Todo' },
];

export function defaultShopConfigVisibility(): ShopConfigVisibility {
  return {
    resumen: 'manage',
    identidad: 'manage',
    operacion: 'manage',
    pedidos: 'manage',
    comanda: 'manage',
    comanderas: 'manage',
    dispositivos: 'manage',
    menu: 'manage',
    carta: 'manage',
    avanzado: 'manage',
  };
}

function coerceShopConfigLevel(raw: unknown): ShopConfigLevel {
  if (raw === true || raw === 'manage' || raw === 'todo' || raw === 'all') return 'manage';
  if (raw === 'read' || raw === 'ver' || raw === 'view') return 'read';
  if (raw === false || raw === 'none' || raw === 'off') return 'none';
  if (raw === 'manage' || raw === 'read' || raw === 'none') return raw;
  return 'manage';
}

/** Normaliza JSON parcial o legado boolean; default manage. */
export function normalizeShopConfigVisibility(
  raw?: Partial<Record<ShopConfigVisibilityKey, unknown>> | null,
): ShopConfigVisibility {
  const base = defaultShopConfigVisibility();
  if (!raw || typeof raw !== 'object') return base;
  for (const key of SHOP_CONFIG_VISIBILITY_KEYS) {
    if (raw[key] !== undefined) base[key] = coerceShopConfigLevel(raw[key]);
  }
  // Antes el token vivía en Operación: si no hay clave nueva, heredar ese nivel.
  if (raw.comanderas === undefined && raw.operacion !== undefined) {
    base.comanderas = coerceShopConfigLevel(raw.operacion);
  }
  return base;
}

export function mergeShopConfigVisibility(
  prev: ShopConfigVisibility | null | undefined,
  patch?: Partial<Record<ShopConfigVisibilityKey, unknown>> | null,
): ShopConfigVisibility {
  const base = normalizeShopConfigVisibility(prev);
  if (!patch || typeof patch !== 'object') return base;
  for (const key of SHOP_CONFIG_VISIBILITY_KEYS) {
    if (patch[key] !== undefined) base[key] = coerceShopConfigLevel(patch[key]);
  }
  return base;
}

export function shopConfigLevelOf(
  visibility: ShopConfigVisibility | null | undefined,
  key: ShopConfigVisibilityKey,
): ShopConfigLevel {
  return normalizeShopConfigVisibility(visibility)[key];
}

export function canSeeShopConfig(
  visibility: ShopConfigVisibility | null | undefined,
  key: ShopConfigVisibilityKey,
): boolean {
  return shopConfigLevelOf(visibility, key) !== 'none';
}

export function canEditShopConfig(
  visibility: ShopConfigVisibility | null | undefined,
  key: ShopConfigVisibilityKey,
): boolean {
  return shopConfigLevelOf(visibility, key) === 'manage';
}

export function hasAnyShopConfigSection(
  visibility: ShopConfigVisibility | null | undefined,
): boolean {
  const v = normalizeShopConfigVisibility(visibility);
  return SHOP_CONFIG_VISIBILITY_KEYS.some((k) => v[k] !== 'none');
}
