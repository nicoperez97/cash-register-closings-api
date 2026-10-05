/**
 * Clave de “carril” para emparejar movimientos del cierre en el preview de re-sync.
 * Distingue ingreso de efectivo, retiro y cambio en caja: si todos caen en `cash`,
 * el soft-match cruza asientos distintos y inventa diferencias.
 */
export function movementChannelKey(name: string): string {
  const nrm = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (nrm.includes('efectivo del dia')) return 'cash_income';
  if (nrm.includes('cambio en caja')) return 'cash_change';
  // "Efectivo — Socio" / "Efectivo - Socio"
  if (/^efectivo\s*[-—]/.test(nrm) || nrm.includes('efectivo —') || nrm.includes('efectivo -')) {
    return 'cash_withdrawal';
  }

  if (nrm.includes('dividendo')) return 'dividend';
  if (nrm.includes('pvs') || nrm.includes('posnet') || nrm.includes('tarjeta')) return 'card';
  if (nrm.includes('mp') || nrm.includes('mercado')) return 'mp';
  // Nombre de cuenta (p. ej. "Efectivo Caja") u otros labels genéricos.
  if (nrm.includes('efectivo') || nrm.includes('caja')) return 'cash';
  if (nrm.includes('dni')) return 'dni';
  if (nrm.includes('delivery') || nrm.includes('rappi') || nrm.includes('pedidosya')) {
    return 'delivery';
  }
  if (nrm.includes('transfer')) return 'transfer';
  return nrm.replace(/[^a-z0-9]+/g, '');
}

/** Clave exacta descripción + cuentas + monto (preview / absorb de huérfanos). */
export function movementExactKey(row: {
  description?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  amountUyu?: string | number | null;
}): string {
  const amt = Number(row.amountUyu ?? 0).toFixed(2);
  return `${String(row.description ?? '').trim()}|${row.fromAccountId ?? ''}|${row.toAccountId ?? ''}|${amt}`;
}

export function sameMovementEconomics(
  a: {
    fromAccountId?: string | null;
    toAccountId?: string | null;
    amountUyu?: string | number | null;
  },
  b: {
    fromAccountId?: string | null;
    toAccountId?: string | null;
    amountUyu?: string | number | null;
  },
): boolean {
  const amt = (v?: string | number | null) => Number(v ?? 0);
  return (
    (a.fromAccountId ?? null) === (b.fromAccountId ?? null) &&
    (a.toAccountId ?? null) === (b.toAccountId ?? null) &&
    Math.abs(amt(a.amountUyu) - amt(b.amountUyu)) < 0.005
  );
}

/**
 * Retiro del cierre: mismo socio destino + monto, aunque la caja origen difiera
 * (cuenta CASH del local vs código EFECTIVO) o la etiqueta no coincida.
 */
export function sameWithdrawalEconomics(
  a: {
    description?: string | null;
    toAccountId?: string | null;
    amountUyu?: string | number | null;
  },
  b: {
    description?: string | null;
    toAccountId?: string | null;
    amountUyu?: string | number | null;
  },
): boolean {
  if (movementChannelKey(String(a.description ?? '')) !== 'cash_withdrawal') return false;
  if (movementChannelKey(String(b.description ?? '')) !== 'cash_withdrawal') return false;
  const amt = (v?: string | number | null) => Number(v ?? 0);
  return (
    (a.toAccountId ?? null) === (b.toAccountId ?? null) &&
    !!a.toAccountId &&
    Math.abs(amt(a.amountUyu) - amt(b.amountUyu)) < 0.005
  );
}

const amtN = (v?: string | number | null) => Number(v ?? 0);

/**
 * Excel histórico: un Ingreso → Socio (“Ventas en efectivo”) cubre efectivo del día + retiro.
 * Tolera pequeños desfaces de monto (cierre vs planilla).
 */
export function findCashShortcutOrphan<
  T extends {
    id: string;
    toAccountId?: string | null;
    amountUyu?: string | number | null;
    fromAccount?: { code?: string | null; name?: string } | null;
  },
>(
  pool: T[],
  unusedIds: Set<string>,
  partnerId: string | null | undefined,
  targetAmounts: number[],
  isIngreso: (row: T) => boolean,
): T | undefined {
  if (!partnerId) return undefined;
  const targets = targetAmounts.filter((a) => a > 0.005);
  const candidates = pool.filter(
    (m) => unusedIds.has(m.id) && isIngreso(m) && m.toAccountId === partnerId,
  );
  if (!candidates.length) return undefined;

  for (const target of targets) {
    const exact = candidates.find((m) => Math.abs(amtN(m.amountUyu) - target) < 0.005);
    if (exact) return exact;
  }

  // Desfase chico (ej. cierre 466k vs Excel 476k).
  let best: T | undefined;
  let bestScore = Infinity;
  for (const m of candidates) {
    const a = amtN(m.amountUyu);
    for (const target of targets) {
      const denom = Math.max(a, target, 1);
      const rel = Math.abs(a - target) / denom;
      if (rel <= 0.05 && rel < bestScore) {
        best = m;
        bestScore = rel;
      }
    }
  }
  if (best) return best;

  // Un solo Ingreso→ese socio ese día: es el atajo aunque el monto no calce fino.
  if (candidates.length === 1) return candidates[0];
  return undefined;
}
