/** Utilidades de paginación server-side (aditivas y compatibles hacia atrás). */

export interface PageParams {
  page: number;
  pageSize: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/**
 * Devuelve los parámetros de paginación si el cliente los pidió (`page` o
 * `pageSize` presentes en la query), o `null` si no —en ese caso el endpoint
 * mantiene su comportamiento actual (array completo).
 */
export function parsePageParams(
  query: Record<string, string | undefined> | undefined,
): PageParams | null {
  if (!query) return null;
  if (query.page == null && query.pageSize == null) return null;
  let page = parseInt(String(query.page ?? '1'), 10);
  let pageSize = parseInt(String(query.pageSize ?? DEFAULT_PAGE_SIZE), 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;
  return { page, pageSize };
}

/** Offset (0-based) para SQL a partir de page (1-based). */
export function offsetOf(params: PageParams): number {
  return (params.page - 1) * params.pageSize;
}

export function paginated<T>(items: T[], total: number, params: PageParams): Paginated<T> {
  return { items, total, page: params.page, pageSize: params.pageSize };
}
