import { mergeCommissionSales } from './commissions.service';
import { combineSourceAmounts, normalizeSalesSource } from '../../common/sales-source';

describe('Comisiones: Ventas + Ventas POS por rubro', () => {
  const ventas = [
    { category: 'Comida', amount: 1000, qty: 10 },
    { category: 'Bebidas', amount: 300, qty: 6 },
  ];
  const pos = [
    { category: 'COMIDA', amount: 500, qty: 4 },
    { category: 'Postres', amount: 200, qty: 2 },
  ];

  it('une el mismo rubro de ambos orígenes y conserva el desglose', () => {
    const rows = mergeCommissionSales('all', ventas, pos);
    const comida = rows.find((r) => r.category === 'Comida')!;
    expect(comida).toMatchObject({ salesAmount: 1000, posAmount: 500, amount: 1500, qty: 14 });
    expect(rows.map((r) => r.category)).toEqual(['Comida', 'Bebidas', 'Postres']);
  });

  it('solo Ventas: la base ignora POS pero el desglose sigue', () => {
    const rows = mergeCommissionSales('sales', ventas, pos);
    const comida = rows.find((r) => r.category === 'Comida')!;
    expect(comida).toMatchObject({ salesAmount: 1000, posAmount: 500, amount: 1000 });
    expect(rows.find((r) => r.category === 'Postres')!.amount).toBe(0);
  });

  it('solo Ventas POS', () => {
    const rows = mergeCommissionSales('pos', ventas, pos);
    expect(rows.find((r) => r.category === 'Comida')!.amount).toBe(500);
    expect(rows.find((r) => r.category === 'Bebidas')!.amount).toBe(0);
  });

  it('origen desconocido = ambos', () => {
    expect(normalizeSalesSource('cualquiera')).toBe('all');
    expect(normalizeSalesSource('POS')).toBe('pos');
    expect(combineSourceAmounts('all', { salesAmount: 1.25, posAmount: 2 }).amount).toBe(3.25);
  });
});
