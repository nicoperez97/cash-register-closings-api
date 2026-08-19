import { ConceptCategory } from './enums';

export const CONCEPT_CATEGORIES: ConceptCategory[] = [
  ConceptCategory.EMPLOYEES,
  ConceptCategory.SERVICES,
  ConceptCategory.SUPPLIERS,
  ConceptCategory.MOVEMENTS,
  ConceptCategory.OTHERS,
];

export type PaymentConceptScope = 'supplier' | 'service' | 'employee' | 'movement';

export type PaymentConceptCategoriesMap = Record<PaymentConceptScope, ConceptCategory[]>;

export const DEFAULT_PAYMENT_CONCEPT_CATEGORIES: PaymentConceptCategoriesMap = {
  supplier: [ConceptCategory.SUPPLIERS],
  service: [ConceptCategory.SERVICES, ConceptCategory.SUPPLIERS],
  employee: [ConceptCategory.EMPLOYEES],
  movement: [ConceptCategory.MOVEMENTS],
};

const CATEGORY_SET = new Set<string>(CONCEPT_CATEGORIES);

export function normalizeConceptCategories(
  raw?: unknown,
  fallback: ConceptCategory[] = [ConceptCategory.MOVEMENTS],
): ConceptCategory[] {
  const list = Array.isArray(raw) ? raw : [];
  const next = [
    ...new Set(
      list
        .map((v) => String(v ?? '').trim().toUpperCase())
        .filter((v): v is ConceptCategory => CATEGORY_SET.has(v)),
    ),
  ];
  return next.length ? next : fallback;
}

export function normalizePaymentConceptCategories(
  raw?: unknown,
): PaymentConceptCategoriesMap {
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    supplier: normalizeConceptCategories(
      src['supplier'],
      DEFAULT_PAYMENT_CONCEPT_CATEGORIES.supplier,
    ),
    service: normalizeConceptCategories(
      src['service'],
      DEFAULT_PAYMENT_CONCEPT_CATEGORIES.service,
    ),
    employee: normalizeConceptCategories(
      src['employee'],
      DEFAULT_PAYMENT_CONCEPT_CATEGORIES.employee,
    ),
    movement: normalizeConceptCategories(
      src['movement'],
      DEFAULT_PAYMENT_CONCEPT_CATEGORIES.movement,
    ),
  };
}

export function conceptMatchesCategories(
  categories: unknown,
  wanted: ConceptCategory[],
): boolean {
  if (!wanted.length) return true;
  const have = new Set(normalizeConceptCategories(categories, [ConceptCategory.OTHERS]));
  return wanted.some((c) => have.has(c));
}

export function isPaymentConceptScope(v: string | undefined | null): v is PaymentConceptScope {
  return v === 'supplier' || v === 'service' || v === 'employee' || v === 'movement';
}

export function inferConceptCategories(name: string): ConceptCategory[] {
  const n = (name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const cats = new Set<ConceptCategory>([ConceptCategory.MOVEMENTS]);
  if (/(sueldo|nomina|comision.*emple|personal|staff|empleado)/.test(n)) {
    cats.add(ConceptCategory.EMPLOYEES);
  }
  if (/(luz|gas|internet|alquiler|seguro|habilitacion|monotributo|servicio)/.test(n)) {
    cats.add(ConceptCategory.SERVICES);
  }
  if (
    /(verdul|queser|carnic|pescad|panad|fiambr|almacen|lacteo|huevo|congel|aceite|bebida|cerveza|cafe|helad|materia prima|insumo|descart|limpieza|utensil|vajilla)/.test(
      n,
    )
  ) {
    cats.add(ConceptCategory.SUPPLIERS);
  }
  if (/(otro|varios)/.test(n)) cats.add(ConceptCategory.OTHERS);
  return [...cats];
}
