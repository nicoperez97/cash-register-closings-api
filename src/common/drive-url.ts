/**
 * Convierte un vínculo de Google Drive ("copiar vínculo") a una URL usable en <img>.
 * Si no es Drive, devuelve la URL original recortada.
 */
export function normalizeLogoUrl(raw?: string | null): string | null {
  const input = raw?.trim();
  if (!input) return null;

  const id = extractGoogleDriveFileId(input);
  if (id) {
    return `https://lh3.googleusercontent.com/d/${id}`;
  }
  return input;
}

export function extractGoogleDriveFileId(url: string): string | null {
  const patterns = [
    /drive\.google\.com\/file\/d\/([^/]+)/i,
    /drive\.google\.com\/open\?[^#]*\bid=([^&]+)/i,
    /drive\.google\.com\/uc\?[^#]*\bid=([^&]+)/i,
    /drive\.google\.com\/thumbnail\?[^#]*\bid=([^&]+)/i,
    /docs\.google\.com\/[^/]+\/d\/([^/]+)/i,
    /lh3\.googleusercontent\.com\/d\/([^/?#]+)/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}
