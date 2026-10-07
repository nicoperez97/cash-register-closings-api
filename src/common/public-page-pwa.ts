import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Shop } from '../entities/shop.entity';

/** Kinds instalables (una PWA por URL pública del catálogo). */
export const PUBLIC_PAGE_PWA_KINDS = [
  'menu',
  'ordering',
  'orderLookup',
  'waiter',
  'reservations',
  'reservationSignup',
  'reservationLookup',
  'waiting',
  'attendance',
  'serviceRules',
] as const;

export type PublicPagePwaKind = (typeof PUBLIC_PAGE_PWA_KINDS)[number];

export type PublicPagePwaKindMeta = {
  pathPrefix: string;
  /** Nombre largo (manifest.name / description). */
  fullLabel: string;
  /** short_name / apple title (iOS trunca ~12–13). */
  shortLabel: string;
  /** Letra del badge sobre el logo del local. */
  iconLetter: string;
  descriptionSuffix: string;
  defaultTheme: string;
  backgroundColor: string;
  /** Si el feature del local está apagado → 404. */
  assertEnabled: (shop: Shop) => void;
};

const KIND_META: Record<PublicPagePwaKind, PublicPagePwaKindMeta> = {
  menu: {
    pathPrefix: 'm',
    fullLabel: 'Carta',
    shortLabel: 'Carta',
    iconLetter: 'C',
    descriptionSuffix: 'Menú público',
    defaultTheme: '#1D65A0',
    backgroundColor: '#ffffff',
    assertEnabled: (shop) => {
      if (!shop.menuEnabled) throw new NotFoundException('Carta no disponible en este local');
    },
  },
  ordering: {
    pathPrefix: 'pedir',
    fullLabel: 'Pedir',
    shortLabel: 'Pedir',
    iconLetter: 'P',
    descriptionSuffix: 'Pedidos online',
    defaultTheme: '#2e7d32',
    backgroundColor: '#eef1ee',
    assertEnabled: (shop) => {
      if (!shop.onlineOrderingEnabled) {
        throw new NotFoundException('Pedidos online no disponibles en este local');
      }
    },
  },
  orderLookup: {
    pathPrefix: 'mi-pedido',
    fullLabel: 'Consultar pedido',
    shortLabel: 'Mi pedido',
    iconLetter: 'M',
    descriptionSuffix: 'Consulta de pedido',
    defaultTheme: '#2e7d32',
    backgroundColor: '#eef1ee',
    assertEnabled: (shop) => {
      if (!shop.onlineOrderingEnabled) {
        throw new NotFoundException('Pedidos online no disponibles en este local');
      }
    },
  },
  waiter: {
    pathPrefix: 'mozo',
    fullLabel: 'Comanda mozos',
    shortLabel: 'Comanda',
    iconLetter: 'C',
    descriptionSuffix: 'Comanda de mozos',
    defaultTheme: '#1D65A0',
    backgroundColor: '#eef1ee',
    assertEnabled: (shop) => {
      if (!shop.waiterOrderingEnabled) {
        throw new NotFoundException('Comanda mozos no disponible en este local');
      }
    },
  },
  reservations: {
    pathPrefix: 'r',
    fullLabel: 'Reservas',
    shortLabel: 'Reservas',
    iconLetter: 'R',
    descriptionSuffix: 'en vivo',
    defaultTheme: '#c45c26',
    backgroundColor: '#0e0c0b',
    assertEnabled: (shop) => {
      if (!shop.reservationsEnabled) {
        throw new NotFoundException('Reservas no disponibles en este local');
      }
    },
  },
  reservationSignup: {
    pathPrefix: 'reservar',
    fullLabel: 'Reservar',
    shortLabel: 'Reservar',
    iconLetter: 'R',
    descriptionSuffix: 'Formulario de reserva',
    defaultTheme: '#c45c26',
    backgroundColor: '#0e0c0b',
    assertEnabled: (shop) => {
      if (!shop.reservationsEnabled) {
        throw new NotFoundException('Reservas no disponibles en este local');
      }
      if (shop.reservationSignupEnabled === false) {
        throw new NotFoundException('Formulario de reserva cerrado en este local');
      }
    },
  },
  reservationLookup: {
    pathPrefix: 'mi-reserva',
    fullLabel: 'Consultar reserva',
    shortLabel: 'Mi reserva',
    iconLetter: 'M',
    descriptionSuffix: 'Consulta de reserva',
    defaultTheme: '#c45c26',
    backgroundColor: '#0e0c0b',
    assertEnabled: (shop) => {
      if (!shop.reservationsEnabled) {
        throw new NotFoundException('Reservas no disponibles en este local');
      }
    },
  },
  waiting: {
    pathPrefix: 'w',
    fullLabel: 'Lista de espera',
    shortLabel: 'Espera',
    iconLetter: 'E',
    descriptionSuffix: 'en vivo',
    defaultTheme: '#2e7d32',
    backgroundColor: '#0e0c0b',
    assertEnabled: (shop) => {
      if (!shop.waitingListEnabled) {
        throw new NotFoundException('Lista de espera no disponible en este local');
      }
    },
  },
  attendance: {
    pathPrefix: 'p',
    fullLabel: 'Presentismo',
    shortLabel: 'Presentismo',
    iconLetter: 'P',
    descriptionSuffix: 'Marcación del personal',
    defaultTheme: '#1D65A0',
    backgroundColor: '#ffffff',
    assertEnabled: (shop) => {
      if (!shop.publicAttendanceEnabled) {
        throw new NotFoundException('Presentismo público no disponible en este local');
      }
    },
  },
  serviceRules: {
    pathPrefix: 'n',
    fullLabel: 'Normas de servicio',
    shortLabel: 'Normas',
    iconLetter: 'N',
    descriptionSuffix: 'Normas pre/post servicio',
    defaultTheme: '#1D65A0',
    backgroundColor: '#ffffff',
    assertEnabled: (shop) => {
      if (!shop.publicServiceRulesEnabled) {
        throw new NotFoundException('Normas públicas no disponibles en este local');
      }
    },
  },
};

export function publicPagePwaKindMeta(kind: PublicPagePwaKind): PublicPagePwaKindMeta {
  return KIND_META[kind];
}

export function parsePublicPagePwaKind(raw: string): PublicPagePwaKind {
  const kind = String(raw ?? '').trim() as PublicPagePwaKind;
  if (!(PUBLIC_PAGE_PWA_KINDS as readonly string[]).includes(kind)) {
    throw new BadRequestException('Tipo de página PWA inválido');
  }
  return kind;
}

export function assertOptionalAppOrigin(raw?: string): void {
  if (raw == null || String(raw).trim() === '') return;
  const candidate = String(raw).trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new BadRequestException('appOrigin inválido');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('appOrigin debe ser http(s)');
  }
}

export function buildPublicPagePwaManifest(
  shop: Shop,
  kind: PublicPagePwaKind,
  appOriginRaw?: string,
) {
  const meta = KIND_META[kind];
  meta.assertEnabled(shop);
  // ?appOrigin= opcional (contrato legacy); el manifest usa paths relativos.
  assertOptionalAppOrigin(appOriginRaw);

  const startPath = `/${meta.pathPrefix}/${encodeURIComponent(shop.slug)}`;
  const theme = (shop.accentColor || '').trim() || meta.defaultTheme;
  const name = `${meta.fullLabel} · ${shop.name}`;
  const shortName = meta.shortLabel;

  const shopLogo = String(shop.logoUrl ?? '').trim()
    ? `/api/v1/public/shops/${encodeURIComponent(shop.id)}/logo`
    : null;

  return {
    name,
    short_name: shortName,
    description: `${meta.fullLabel} — ${meta.descriptionSuffix} — ${shop.name}`,
    lang: 'es-AR',
    dir: 'ltr',
    display: 'standalone',
    orientation: 'any',
    theme_color: theme,
    background_color: meta.backgroundColor,
    // id distinto de la app "Cierres" (/) para instalación separada
    id: startPath,
    scope: startPath,
    start_url: startPath,
    categories: ['business', 'food'],
    /** Logo puro del local (favicon de la pestaña). Los `icons` llevan badge de página. */
    shop_logo: shopLogo,
    icons: buildPublicPagePwaIcons(shop.slug, kind),
  };
}

/**
 * Íconos generados same-origin (logo + inicial). Fallback a PNG del front por si el
 * endpoint de composición falla al instalar.
 */
function buildPublicPagePwaIcons(slug: string, kind: PublicPagePwaKind) {
  const enc = encodeURIComponent(slug);
  const base = `/api/v1/public/shops/${enc}/pwa-icons/${kind}`;
  return [
    { src: `${base}/192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${base}/512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${base}/512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: `${base}/180.png`, sizes: '180x180', type: 'image/png', purpose: 'any' },
    {
      src: '/icons/icon-192x192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icons/icon-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
  ];
}
