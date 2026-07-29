/** Etiquetas en español para reportes / Excel (valores de DB siguen en inglés). */

export function closingStatusLabel(status?: string | null): string {
  const map: Record<string, string> = {
    DRAFT: 'Borrador',
    SUBMITTED: 'Enviado',
    LOCKED: 'Bloqueado',
  };
  return map[status ?? ''] ?? status ?? '';
}

export function expenseCategoryLabel(category?: string | null): string {
  const map: Record<string, string> = {
    SUPPLIES: 'Insumos',
    SERVICES: 'Servicios',
    TRANSFER_SHOP: 'Transferencia entre locales',
    OTHER: 'Otros',
    RAW_MATERIALS: 'Materia prima',
    DRINKS: 'Bebida',
    SALARIES: 'Sueldos',
    RENT: 'Alquiler',
    EQUIPMENT: 'Equipamiento',
    CLEANING: 'Artículos de limpieza',
    DISPOSABLES: 'Descartables',
    UTILITIES: 'Servicios (luz/gas)',
    MARKETING: 'Marketing',
    COMMISSIONS: 'Comisiones empleados',
  };
  return map[category ?? ''] ?? category ?? '';
}

export function conceptKindLabel(kind?: string | null): string {
  const map: Record<string, string> = {
    INCOME: 'Ingreso',
    EXPENSE: 'Egreso',
    TRANSFER: 'Transferencia',
  };
  return map[kind ?? ''] ?? kind ?? '';
}

export function accountTypeLabel(type?: string | null): string {
  const map: Record<string, string> = {
    PARTNER: 'Socio',
    CHANNEL: 'Canal',
    SYSTEM: 'Sistema',
  };
  return map[type ?? ''] ?? type ?? '';
}

export function payrollStatusLabel(status?: string | null): string {
  const map: Record<string, string> = {
    DRAFT: 'Borrador',
    LOCKED: 'Cerrado',
  };
  return map[status ?? ''] ?? status ?? '';
}
