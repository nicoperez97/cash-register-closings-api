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
  };
  return map[category ?? ''] ?? category ?? '';
}
