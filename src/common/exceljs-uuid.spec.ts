import * as ExcelJS from 'exceljs';

/**
 * uuid está forzado a v11 (override en package.json, por GHSA-w5hq-g745-h8pq).
 * exceljs lo usa con require('uuid').v4 en el formato condicional extendido:
 * este test se rompe si una actualización deja a exceljs sin uuid compatible.
 */
describe('exceljs con uuid 11', () => {
  it('escribe y relee una planilla con formato condicional (dataBar)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ventas');
    ws.addRows([[100], [250], [75]]);
    ws.addConditionalFormatting({
      ref: 'A1:A3',
      rules: [
        {
          type: 'dataBar',
          priority: 1,
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: { argb: 'FF2E7D32' },
        } as ExcelJS.ConditionalFormattingRule,
      ],
    });

    const buffer = await wb.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);

    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buffer as ArrayBuffer);
    expect(back.getWorksheet('Ventas')?.getCell('A2').value).toBe(250);
  });
});
