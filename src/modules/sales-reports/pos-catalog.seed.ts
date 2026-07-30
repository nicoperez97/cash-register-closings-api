/**
 * Catálogo base según reporte de comisiones Kevin + XLS Restosoft (reporte16.6-15.7).
 *
 * Rubro = dimensión de comisión (COMIDA / PIZZA / EVENTO…).
 * Subrubro = desglose interno.
 * El match principal es por **código** POS (más fiable que el nombre).
 */

export type SeedProduct = {
  /** Código Restosoft (string numérico). */
  code?: string;
  name: string;
  category: string;
  subcategory: string;
};

export const SEED_CATEGORIES: Array<{ name: string; sortOrder: number; notes?: string }> = [
  { name: 'COMIDA', sortOrder: 1, notes: 'Comisión Kevin 1% (reporte ventas)' },
  { name: 'PIZZA', sortOrder: 2, notes: 'Comisión Kevin 2,5% (reporte ventas)' },
  { name: 'EVENTO CASA TOMADA', sortOrder: 3, notes: 'Comisión Kevin 2,5% (reporte ventas)' },
  { name: 'BEBIDAS', sortOrder: 4, notes: 'Inferido del XLS Restosoft' },
  { name: 'VINOS', sortOrder: 5, notes: 'Inferido del XLS Restosoft' },
];

export const SEED_SUBCATEGORIES: Array<{
  category: string;
  name: string;
  sortOrder: number;
}> = [
  { category: 'COMIDA', name: 'Entradas', sortOrder: 1 },
  { category: 'COMIDA', name: 'Pastas', sortOrder: 2 },
  { category: 'COMIDA', name: 'Principales', sortOrder: 3 },
  { category: 'COMIDA', name: 'Postres', sortOrder: 4 },
  { category: 'PIZZA', name: 'Pizzas', sortOrder: 1 },
  { category: 'EVENTO CASA TOMADA', name: 'Evento', sortOrder: 1 },
  { category: 'BEBIDAS', name: 'Sin alcohol', sortOrder: 1 },
  { category: 'BEBIDAS', name: 'Cervezas', sortOrder: 2 },
  { category: 'BEBIDAS', name: 'Cocteles', sortOrder: 3 },
  // Carta VINOS TUTTO PASSA - INVIERNO (subrubros = cepas / estilo)
  { category: 'VINOS', name: 'Pinot Noir', sortOrder: 1 },
  { category: 'VINOS', name: 'Malbec', sortOrder: 2 },
  { category: 'VINOS', name: 'Blend', sortOrder: 3 },
  { category: 'VINOS', name: 'I Vini', sortOrder: 4 },
  { category: 'VINOS', name: 'Bonarda', sortOrder: 5 },
  { category: 'VINOS', name: 'Cabernet Franc', sortOrder: 6 },
  { category: 'VINOS', name: 'Rose', sortOrder: 7 },
  { category: 'VINOS', name: 'Blanc', sortOrder: 8 },
  { category: 'VINOS', name: 'Otros', sortOrder: 9 },
];

/** Platos del PDF Kevin + códigos del XLS Restosoft. */
export const SEED_PRODUCTS_FROM_REPORT: SeedProduct[] = [
  // COMIDA — Entradas
  { code: '107', name: 'ARANCINI SICILIANI', category: 'COMIDA', subcategory: 'Entradas' },
  { code: '884', name: 'ARANCINO ( 1 UNIDAD )', category: 'COMIDA', subcategory: 'Entradas' },
  { code: '101', name: 'BURRATINA PROSCIUTTO E POMODOR', category: 'COMIDA', subcategory: 'Entradas' },
  { code: '874', name: 'EMPANADAS', category: 'COMIDA', subcategory: 'Entradas' },
  { code: '104', name: 'NOSTRI SALUMI E FORMAGGI', category: 'COMIDA', subcategory: 'Entradas' },
  { code: '111', name: 'PROVOLA DELLA CASA', category: 'COMIDA', subcategory: 'Entradas' },
  // COMIDA — Pastas
  { code: '203', name: 'FETTUCCINE CON  LE POLPETTE', category: 'COMIDA', subcategory: 'Pastas' },
  { code: '201', name: 'LASAGNA DELLA NONNA', category: 'COMIDA', subcategory: 'Pastas' },
  { code: '202', name: 'PASTA NCASCIATA', category: 'COMIDA', subcategory: 'Pastas' },
  { code: '881', name: 'RAVIOLONI AL SUGO', category: 'COMIDA', subcategory: 'Pastas' },
  { code: '838', name: 'SORRENTINO DALL BOSCO', category: 'COMIDA', subcategory: 'Pastas' },
  { code: '872', name: 'RISOTTO DE HONGOS', category: 'COMIDA', subcategory: 'Pastas' },
  // COMIDA — Principales
  { code: '105', name: 'BRACIOLE ALLA MESSINESE', category: 'COMIDA', subcategory: 'Principales' },
  { code: '102', name: 'MELANZANE ALLA PARMIGIANA', category: 'COMIDA', subcategory: 'Principales' },
  { code: '110', name: 'PEPERONATA SICILIANA', category: 'COMIDA', subcategory: 'Principales' },
  { code: '837', name: 'POLPETTA RIPIENA', category: 'COMIDA', subcategory: 'Principales' },
  { code: '880', name: 'POLPETTINE AL SUGO', category: 'COMIDA', subcategory: 'Principales' },
  { code: '877', name: 'CARBONERO ETICO', category: 'COMIDA', subcategory: 'Principales' },
  // COMIDA — Postres
  { code: '401', name: 'CANNOLI SICILIANI', category: 'COMIDA', subcategory: 'Postres' },
  { code: '875', name: 'FLAN', category: 'COMIDA', subcategory: 'Postres' },
  { code: '875', name: 'FLAN DELLA NONNA', category: 'COMIDA', subcategory: 'Postres' },
  { code: '843', name: 'PANNA COTTA', category: 'COMIDA', subcategory: 'Postres' },
  { code: '403', name: 'SALAME DI CIOCCOLATO', category: 'COMIDA', subcategory: 'Postres' },
  { code: '402', name: 'TIRAMISU', category: 'COMIDA', subcategory: 'Postres' },
  // PIZZA
  { code: '839', name: 'BACCI DEL DIAVOLO', category: 'PIZZA', subcategory: 'Pizzas' },
  { code: '840', name: 'DEL BOSCO', category: 'PIZZA', subcategory: 'Pizzas' },
  { code: '304', name: 'DELLA CASA', category: 'PIZZA', subcategory: 'Pizzas' },
  { code: '303', name: 'FORMAGGINI', category: 'PIZZA', subcategory: 'Pizzas' },
  { code: '301', name: 'MARGHERITA', category: 'PIZZA', subcategory: 'Pizzas' },
  { code: '305', name: 'NAPULE', category: 'PIZZA', subcategory: 'Pizzas' },
  { code: '842', name: 'SPECIALE', category: 'PIZZA', subcategory: 'Pizzas' },
  { code: '841', name: 'VEGGIE', category: 'PIZZA', subcategory: 'Pizzas' },
];

export const SEED_EXTRA_PRODUCTS: SeedProduct[] = [
  // BEBIDAS — Sin alcohol
  { code: '605', name: 'AGUA MINERAL', category: 'BEBIDAS', subcategory: 'Sin alcohol' },
  { code: '604', name: 'AGUA SABORIZADA', category: 'BEBIDAS', subcategory: 'Sin alcohol' },
  { code: '601', name: 'COCA COLA', category: 'BEBIDAS', subcategory: 'Sin alcohol' },
  { code: '602', name: 'COCA ZERO', category: 'BEBIDAS', subcategory: 'Sin alcohol' },
  { code: '603', name: 'SPRITE', category: 'BEBIDAS', subcategory: 'Sin alcohol' },
  { code: '826', name: 'FANTA', category: 'BEBIDAS', subcategory: 'Sin alcohol' },
  { code: '607', name: 'LIMONADA JARRA', category: 'BEBIDAS', subcategory: 'Sin alcohol' },
  { code: '606', name: 'SIFON SODA CHICO', category: 'BEBIDAS', subcategory: 'Sin alcohol' },
  { code: '847', name: 'SCHWEPPES POMELO', category: 'BEBIDAS', subcategory: 'Sin alcohol' },
  { code: '848', name: 'SCHWEPPES TONICA', category: 'BEBIDAS', subcategory: 'Sin alcohol' },
  // BEBIDAS — Cervezas
  { code: '701', name: 'HEINEKEN TIRADA', category: 'BEBIDAS', subcategory: 'Cervezas' },
  { code: '702', name: 'PERONI', category: 'BEBIDAS', subcategory: 'Cervezas' },
  { code: '836', name: 'PERONI 2X1', category: 'BEBIDAS', subcategory: 'Cervezas' },
  { code: '835', name: 'PERONI PROMO 2X1', category: 'BEBIDAS', subcategory: 'Cervezas' },
  { code: '834', name: 'PROMO HEINEKEN 2X1', category: 'BEBIDAS', subcategory: 'Cervezas' },
  { code: '885', name: '3X1 HEINEKEN', category: 'BEBIDAS', subcategory: 'Cervezas' },
  { code: '883', name: '3X2 HEINEKEN', category: 'BEBIDAS', subcategory: 'Cervezas' },
  // BEBIDAS — Cocteles
  { code: '876', name: '2X1 FERNET', category: 'BEBIDAS', subcategory: 'Cocteles' },
  { code: '501', name: 'APEROL SPRITZ', category: 'BEBIDAS', subcategory: 'Cocteles' },
  { code: '502', name: 'CAMPARI SPRITZ', category: 'BEBIDAS', subcategory: 'Cocteles' },
  { code: '503', name: 'FERNET BRANCA', category: 'BEBIDAS', subcategory: 'Cocteles' },
  { code: '506', name: 'GIN HEREDERO TIRADO', category: 'BEBIDAS', subcategory: 'Cocteles' },
  { code: '844', name: 'NEGRONI', category: 'BEBIDAS', subcategory: 'Cocteles' },
  { code: '507', name: 'SIDRA TIRADA', category: 'BEBIDAS', subcategory: 'Cocteles' },
  { code: '504', name: 'VERMU CINZANO', category: 'BEBIDAS', subcategory: 'Cocteles' },
  { code: '505', name: 'VERMU INTERFERENCIA TIRADO', category: 'BEBIDAS', subcategory: 'Cocteles' },
  // VINOS — subrubros según carta PDF “VINOS TUTTO PASSA - INVIERNO”
  { code: '850', name: 'ALFEDRO ROCA FINCAS', category: 'VINOS', subcategory: 'Pinot Noir' },
  { code: '852', name: 'LAUREANO GOMEZ TERROIR RESERVA', category: 'VINOS', subcategory: 'Pinot Noir' },
  { code: '858', name: 'BOMBI', category: 'VINOS', subcategory: 'Malbec' },
  { code: '857', name: 'CASUAL PREMIUM MALBEC', category: 'VINOS', subcategory: 'Malbec' },
  { code: '849', name: 'DELANDE FUTRE', category: 'VINOS', subcategory: 'Malbec' },
  { code: '859', name: 'ESENCIAL MALBEC', category: 'VINOS', subcategory: 'Malbec' },
  { code: '878', name: 'MAD BIRD MALBEC', category: 'VINOS', subcategory: 'Malbec' },
  { code: '853', name: 'MAD BIRD BLEND', category: 'VINOS', subcategory: 'Blend' },
  { code: '851', name: 'ALPATACO', category: 'VINOS', subcategory: 'I Vini' },
  { code: '846', name: 'CUORE GIALLO', category: 'VINOS', subcategory: 'I Vini' },
  { code: '845', name: 'TOMASSO', category: 'VINOS', subcategory: 'I Vini' },
  { code: '882', name: 'CARDINALE', category: 'VINOS', subcategory: 'I Vini' },
  { code: '863', name: 'AMULETO', category: 'VINOS', subcategory: 'Bonarda' },
  { code: '860', name: 'CASUAL PREMIUM CABERNET FRANC', category: 'VINOS', subcategory: 'Cabernet Franc' },
  { code: '861', name: 'AMAZONIC', category: 'VINOS', subcategory: 'Cabernet Franc' },
  { code: '864', name: 'MAD BIRD ROSE', category: 'VINOS', subcategory: 'Rose' },
  { code: '865', name: 'ESTELAR BLANCO', category: 'VINOS', subcategory: 'Blanc' },
  { code: '855', name: 'CAVA NEGRA', category: 'VINOS', subcategory: 'Otros' },
  { code: '856', name: 'LA MALA MARIA JOVEN', category: 'VINOS', subcategory: 'Otros' },
  { code: '873', name: 'MANUEL VILLALBA', category: 'VINOS', subcategory: 'Otros' },
];

export function normProductName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normaliza códigos Restosoft ("301", "301.0" → "301"). */
export function normProductCode(code: string | null | undefined): string {
  if (!code) return '';
  let s = String(code).trim();
  if (/^\d+\.0+$/.test(s)) s = String(parseInt(s, 10));
  else if (/^\d+\.\d+$/.test(s)) s = s.replace(/\.0+$/, '');
  return s;
}

export function allSeedProducts(): SeedProduct[] {
  return [...SEED_PRODUCTS_FROM_REPORT, ...SEED_EXTRA_PRODUCTS];
}

/**
 * Fallback por rango de código Restosoft cuando no hay match exacto.
 * 1xx entradas/principales, 2xx pastas, 3xx pizza, 4xx postres,
 * 5xx cócteles, 6xx sin alcohol, 7xx cervezas, 8xx+ sin default.
 */
export function guessByCodeRange(
  code: string,
): { category: string; subcategory: string } | null {
  const n = Number(normProductCode(code));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 100 && n < 200) return { category: 'COMIDA', subcategory: 'Entradas' };
  if (n >= 200 && n < 300) return { category: 'COMIDA', subcategory: 'Pastas' };
  if (n >= 300 && n < 400) return { category: 'PIZZA', subcategory: 'Pizzas' };
  if (n >= 400 && n < 500) return { category: 'COMIDA', subcategory: 'Postres' };
  if (n >= 500 && n < 600) return { category: 'BEBIDAS', subcategory: 'Cocteles' };
  if (n >= 600 && n < 700) return { category: 'BEBIDAS', subcategory: 'Sin alcohol' };
  if (n >= 700 && n < 800) return { category: 'BEBIDAS', subcategory: 'Cervezas' };
  return null;
}
