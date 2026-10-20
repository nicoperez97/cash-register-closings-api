import {
  defaultReportVisibility,
  mergeReportsVisibility,
  normalizeReportsVisibility,
  reportCanSeeAmount,
  reportCanSeeQty,
  reportVisibilityForLink,
} from './reports-visibility';

describe('reports-visibility', () => {
  it('sin config guardada todo queda visible (igual que antes de existir)', () => {
    const v = normalizeReportsVisibility(null);
    expect(Object.values(v.closings).every(Boolean)).toBe(true);
    expect(v.sales.amountMode).toBe('both');
    expect(v.stats).toEqual({ kpis: true, charts: true, tips: true, daily: true });
  });

  it('solo Ventas tiene datos numéricos configurables', () => {
    expect(defaultReportVisibility('sales').amountMode).toBe('both');
    expect('amountMode' in defaultReportVisibility('concepts')).toBe(false);
  });

  it('ignora flags desconocidos y normaliza booleanos en texto', () => {
    const v = normalizeReportsVisibility({
      concepts: { kpis: 'false', charts: 0, inventado: false, export: '1' },
    });
    expect(v.concepts).toEqual({
      kpis: false,
      charts: false,
      tabConcepts: true,
      tabDays: true,
      export: true,
    });
  });

  it('merge aplica un patch parcial sin pisar otros reportes ni flags', () => {
    const prev = normalizeReportsVisibility({ closings: { detail: false } });
    const next = mergeReportsVisibility(prev, { sales: { amountMode: 'qty', tabDays: false } });
    expect(next.closings.detail).toBe(false);
    expect(next.sales.tabDays).toBe(false);
    expect(next.sales.tabProducts).toBe(true);
    expect(reportCanSeeAmount(next.sales)).toBe(false);
    expect(reportCanSeeQty(next.sales)).toBe(true);
  });

  it('los admins globales ven todo aunque tengan config guardada', () => {
    const link = { stats: { kpis: false, tips: false } };
    expect(reportVisibilityForLink('stats', true, link).tips).toBe(true);
    expect(reportVisibilityForLink('stats', false, link).tips).toBe(false);
    expect(reportVisibilityForLink('stats', false, link).charts).toBe(true);
  });
});
