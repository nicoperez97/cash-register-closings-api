const n = (v?: number | string | null) => Number(v ?? 0);

export type ClosingRequiredFileRef = { slot: string; sourceId?: string | null };

export type ClosingRequiredFilesSnapshot = {
  shopPosnets: Array<{ id: string; type?: string | null }>;
  posnetAmounts: Array<{
    posnetId: string;
    type?: string | null;
    name?: string | null;
    amount?: number | string | null;
  }>;
  posSystemAmount?: number | string | null;
  cardAmount?: number | string | null;
  mercadoPagoAmount?: number | string | null;
  accountDniAmount?: number | string | null;
  otherAmount?: number | string | null;
  sourceAmounts?: Array<{
    sourceId?: string | null;
    name?: string | null;
    amount?: number | string | null;
  }>;
  files: ClosingRequiredFileRef[];
};

function hasFile(
  files: ClosingRequiredFileRef[],
  slot: string,
  sourceId?: string | null,
): boolean {
  return files.some((f) => {
    if (f.slot !== slot) return false;
    if (slot === 'channel' || slot === 'posnet') {
      return String(f.sourceId ?? '') === String(sourceId ?? '');
    }
    return true;
  });
}

/** Nombres de cuentas con monto y sin archivo, si el usuario tiene el flag. */
export function missingRequiredClosingFiles(snapshot: ClosingRequiredFilesSnapshot): string[] {
  const shopIds = new Set(snapshot.shopPosnets.map((p) => p.id).filter(Boolean));
  const shopTypes = new Set(
    snapshot.shopPosnets.map((p) => String(p.type ?? '')).filter(Boolean),
  );
  const missing: string[] = [];

  for (const row of snapshot.posnetAmounts) {
    if (n(row.amount) <= 0) continue;
    if (!shopIds.has(row.posnetId)) continue;
    if (hasFile(snapshot.files, 'posnet', row.posnetId)) continue;
    missing.push((row.name || '').trim() || 'Posnet');
  }

  if (!shopTypes.has('PVS') && n(snapshot.cardAmount) > 0 && !hasFile(snapshot.files, 'card')) {
    missing.push('PVS');
  }
  if (
    !shopTypes.has('MERCADO_PAGO') &&
    n(snapshot.mercadoPagoAmount) > 0 &&
    !hasFile(snapshot.files, 'mercado_pago')
  ) {
    missing.push('Mercado Pago');
  }

  const extraDni = snapshot.posnetAmounts.some(
    (row) =>
      String(row.type ?? '') === 'CUENTA_DNI' &&
      !shopIds.has(row.posnetId) &&
      n(row.amount) > 0,
  );
  const dniManual = !shopTypes.has('CUENTA_DNI') && n(snapshot.accountDniAmount) > 0;
  if ((extraDni || dniManual) && !hasFile(snapshot.files, 'account_dni')) {
    missing.push('Cuenta DNI');
  }

  if (n(snapshot.otherAmount) > 0 && !hasFile(snapshot.files, 'other')) {
    missing.push('Cobros');
  }

  for (const row of snapshot.sourceAmounts ?? []) {
    const sourceId = String(row.sourceId ?? '');
    if (!sourceId || n(row.amount) <= 0) continue;
    if (hasFile(snapshot.files, 'channel', sourceId)) continue;
    missing.push((row.name || '').trim() || 'Cuenta de canal');
  }

  if (n(snapshot.posSystemAmount) > 0 && !hasFile(snapshot.files, 'pos_system')) {
    missing.push('Caja sistema');
  }

  return missing;
}
