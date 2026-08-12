import { normalizeLogoUrl } from './drive-url';

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** URL absoluta del logo para emails y clientes que requieren http(s). */
export function resolveShopLogoUrlForEmail(
  appOrigin: string,
  shopId: string | null | undefined,
  logoUrlRaw?: string | null,
): string | null {
  const raw = (logoUrlRaw ?? '').trim();
  if (!raw) return null;
  if (shopId && appOrigin) {
    return `${appOrigin.replace(/\/+$/, '')}/api/v1/public/shops/${shopId}/logo`;
  }
  const normalized = normalizeLogoUrl(raw) ?? raw;
  return isHttpUrl(normalized) ? normalized : null;
}
