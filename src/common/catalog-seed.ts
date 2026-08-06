import {
  ConceptKind,
  LedgerAccountType,
  LinkedPaymentMethod,
} from './enums';

/** Solo sistema: se aseguran en cada sync de cierre (no canales ni socios). */
export const SYSTEM_LEDGER_ACCOUNTS: Array<{
  name: string;
  code: string;
  type: LedgerAccountType;
}> = [
  { name: '1. Ingreso', code: 'INGRESO', type: LedgerAccountType.SYSTEM },
  { name: '2. Egreso', code: 'EGRESO', type: LedgerAccountType.SYSTEM },
];

/**
 * Catálogo inicial al crear un local.
 * Los canales NO traen linkedPaymentMethod: eso se configura en «Depósito del cierre».
 */
export const DEFAULT_LEDGER_ACCOUNTS: Array<{
  name: string;
  code: string;
  type: LedgerAccountType;
  linkedPaymentMethod?: LinkedPaymentMethod | null;
}> = [
  ...SYSTEM_LEDGER_ACCOUNTS,
  { name: 'Fonti', code: 'FONTI', type: LedgerAccountType.PARTNER },
  { name: 'Manu', code: 'MANU', type: LedgerAccountType.PARTNER },
  { name: 'Nike', code: 'NIKE', type: LedgerAccountType.PARTNER },
  { name: 'Santi', code: 'SANTI', type: LedgerAccountType.PARTNER },
  { name: 'Toma', code: 'TOMA', type: LedgerAccountType.PARTNER },
  { name: 'Mercado Pago', code: 'MP', type: LedgerAccountType.CHANNEL },
  { name: 'PVS', code: 'PVS', type: LedgerAccountType.CHANNEL },
  { name: 'Cuenta DNI', code: 'DNI', type: LedgerAccountType.CHANNEL },
  { name: 'Efectivo Caja', code: 'EFECTIVO', type: LedgerAccountType.CHANNEL },
  { name: 'Delivery', code: 'DELIVERY', type: LedgerAccountType.CHANNEL },
  { name: 'Transferencia', code: 'TRANSFER', type: LedgerAccountType.CHANNEL },
];

/** Conceptos alineados al Excel del contador (subset operativo + frecuentes). */
export const DEFAULT_CONCEPTS: Array<{ name: string; kind: ConceptKind }> = [
  { name: 'EFECTIVO ingreso', kind: ConceptKind.INCOME },
  { name: 'Cobro', kind: ConceptKind.INCOME },
  { name: 'Ingreso', kind: ConceptKind.INCOME },
  { name: 'Aporte de capital', kind: ConceptKind.INCOME },
  { name: 'Rendimientos financieros', kind: ConceptKind.INCOME },
  { name: 'Transferencia e/ cuentas', kind: ConceptKind.TRANSFER },
  { name: 'Materia prima', kind: ConceptKind.EXPENSE },
  { name: 'Bebida', kind: ConceptKind.EXPENSE },
  { name: 'Sueldos', kind: ConceptKind.EXPENSE },
  { name: 'Comisiones empleados', kind: ConceptKind.EXPENSE },
  { name: 'Alquiler', kind: ConceptKind.EXPENSE },
  { name: 'Equipamiento', kind: ConceptKind.EXPENSE },
  { name: 'Servicios de terceros', kind: ConceptKind.EXPENSE },
  { name: 'Descartables', kind: ConceptKind.EXPENSE },
  { name: 'Artículos de limpieza', kind: ConceptKind.EXPENSE },
  { name: 'Gastos varios', kind: ConceptKind.EXPENSE },
  { name: 'Otros gastos', kind: ConceptKind.EXPENSE },
  { name: 'Utensilios cocina', kind: ConceptKind.EXPENSE },
  { name: 'Luz', kind: ConceptKind.EXPENSE },
  { name: 'Gas', kind: ConceptKind.EXPENSE },
  { name: 'Internet', kind: ConceptKind.EXPENSE },
  { name: 'Seguros', kind: ConceptKind.EXPENSE },
  { name: 'Marketing', kind: ConceptKind.EXPENSE },
  { name: 'Indumentaria', kind: ConceptKind.EXPENSE },
  { name: 'Comisión PVS', kind: ConceptKind.EXPENSE },
  { name: 'Comisión MP', kind: ConceptKind.EXPENSE },
  { name: 'Devolución de cobro', kind: ConceptKind.EXPENSE },
  { name: 'Mobiliario', kind: ConceptKind.EXPENSE },
  { name: 'Infraestructura', kind: ConceptKind.EXPENSE },
  { name: 'Vajilla', kind: ConceptKind.EXPENSE },
  { name: 'Decoración', kind: ConceptKind.EXPENSE },
  { name: 'Comida', kind: ConceptKind.EXPENSE },
  { name: 'Monotributo', kind: ConceptKind.EXPENSE },
  { name: 'Gastos bancarios', kind: ConceptKind.EXPENSE },
  { name: 'Gastos de personal', kind: ConceptKind.EXPENSE },
  { name: 'Habilitaci\u00f3n', kind: ConceptKind.EXPENSE },
  { name: 'Utilidades', kind: ConceptKind.EXPENSE },
  { name: 'Arqueo', kind: ConceptKind.EXPENSE },
  { name: 'Insumos', kind: ConceptKind.EXPENSE },
  { name: 'Servicios', kind: ConceptKind.EXPENSE },
  { name: 'Transferencia entre locales', kind: ConceptKind.EXPENSE },
];

/** Mapeo categoría de egreso del cierre → nombre de concepto. */
export const EXPENSE_CATEGORY_TO_CONCEPT: Record<string, string> = {
  SUPPLIES: 'Insumos',
  SERVICES: 'Servicios',
  TRANSFER_SHOP: 'Transferencia entre locales',
  OTHER: 'Otros gastos',
  RAW_MATERIALS: 'Materia prima',
  DRINKS: 'Bebida',
  SALARIES: 'Sueldos',
  RENT: 'Alquiler',
  EQUIPMENT: 'Equipamiento',
  CLEANING: 'Artículos de limpieza',
  DISPOSABLES: 'Descartables',
  UTILITIES: 'Luz',
  MARKETING: 'Marketing',
  COMMISSIONS: 'Comisiones empleados',
};
