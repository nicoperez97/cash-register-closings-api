import { ExtraLineType } from '../../common/enums';
import { PosnetType } from '../../common/posnet';
import {
  applyPosnetSums,
  calcClosingTotals,
  differenceReasonMissing,
  extraIncomeFromLines,
} from './closing-calc';

describe('calcClosingTotals', () => {
  it('suma canales y usa el declarado si viene', () => {
    const r = calcClosingTotals({
      posSystemAmount: 100_000,
      cardAmount: 40_000,
      cashAmount: 50_000,
      mercadoPagoAmount: 10_000,
      declaredTotal: 99_000,
    });
    expect(r.calculatedTotal).toBe(100_000);
    expect(r.declaredTotal).toBe(99_000);
    expect(r.difference).toBe(1_000);
  });

  it('si no hay declarado, el calculado es el declarado', () => {
    const r = calcClosingTotals({
      posSystemAmount: 80_000,
      cashAmount: 30_000,
      cardAmount: 50_000,
    });
    expect(r.calculatedTotal).toBe(80_000);
    expect(r.declaredTotal).toBe(80_000);
    expect(r.difference).toBe(0);
  });

  it('faltante: caja sistema menor que lo declarado', () => {
    const r = calcClosingTotals({
      posSystemAmount: 90_000,
      cashAmount: 100_000,
      declaredTotal: 100_000,
    });
    expect(r.difference).toBe(-10_000);
  });

  it('suma extraIncome (cuentas aparte / ajustes)', () => {
    const r = calcClosingTotals(
      { posSystemAmount: 12_000, cashAmount: 10_000 },
      2_000,
    );
    expect(r.calculatedTotal).toBe(12_000);
    expect(r.difference).toBe(0);
  });
});

describe('extraIncomeFromLines', () => {
  it('solo suma efectivo estudiantes y ajustes', () => {
    const n = extraIncomeFromLines([
      { type: ExtraLineType.STUDENT_CASH, amount: 1_500 },
      { type: ExtraLineType.ADJUSTMENT, amount: 250 },
      { type: ExtraLineType.OTHER, amount: 9_999 },
      { type: ExtraLineType.STUDENT_CASH, amount: '100.50' },
    ]);
    expect(n).toBe(1_850.5);
  });

  it('vacío o nulo = 0', () => {
    expect(extraIncomeFromLines(null)).toBe(0);
    expect(extraIncomeFromLines([])).toBe(0);
  });
});

describe('applyPosnetSums', () => {
  it('PVS pisa cardAmount y deja MP a mano si no hay posnet MP', () => {
    const next = applyPosnetSums({
      cardAmount: 1,
      mercadoPagoAmount: 8_000,
      accountDniAmount: 3,
      posnetAmounts: [
        { posnetId: 'a', name: 'PVS 1', type: PosnetType.PVS, amount: 4_000 },
        { posnetId: 'b', name: 'PVS 2', type: PosnetType.PVS, amount: 1_500 },
      ],
    });
    expect(next.cardAmount).toBe(5_500);
    expect(next.mercadoPagoAmount).toBe(8_000);
    expect(next.accountDniAmount).toBe(3);
  });

  it('lista vacía no borra montos a mano', () => {
    const next = applyPosnetSums({
      cardAmount: 10,
      mercadoPagoAmount: 20,
      posnetAmounts: [],
    });
    expect(next.cardAmount).toBe(10);
    expect(next.mercadoPagoAmount).toBe(20);
    expect(next.posnetAmounts).toEqual([]);
  });

  it('undefined no toca el dto', () => {
    const dto = { cardAmount: 7, mercadoPagoAmount: 8, posnetAmounts: undefined };
    expect(applyPosnetSums(dto)).toBe(dto);
  });
});

describe('differenceReasonMissing', () => {
  it('0 = no pedir', () => {
    expect(differenceReasonMissing(0, 50_000, '')).toBe(false);
  });

  it('pide motivo si |diff| llega al tope', () => {
    expect(differenceReasonMissing(1_000, 1_000, '  ')).toBe(true);
    expect(differenceReasonMissing(1_000, -1_000, null)).toBe(true);
    expect(differenceReasonMissing(1_000, 999, '')).toBe(false);
    expect(differenceReasonMissing(1_000, 5_000, 'Error de posnet')).toBe(false);
  });
});
