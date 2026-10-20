import * as XLSX from 'xlsx';
import { RestosoftParser } from './restosoft.parser';

/** Arma un archivo como la "Consulta de Comprobantes" de Restosoft en el formato pedido. */
function restosoftFile(bookType: 'xls' | 'xlsx'): Express.Multer.File {
  const rows = [
    ['Tutto Passa'],
    ['Consulta de Comprobantes'],
    ['Periodo', '01/10/2026', '02/10/2026'],
    [],
    ['Fecha', 'Hora', 'Tipo', 'Comprobante', 'Cliente', 'SubTotal', 'Desc/Rec', 'Total', 'Caja', 'Anul', 'FormaDePago'],
    ['01/10/2026', '21:15', 'FB', '0001-00000123', 'Consumidor final', 9000, -500, 8500, '3', '', 'EF'],
    ['', '', 2, 'P01', 'Pizza muzzarella', 6000],
    ['', '', 1, 'B02', 'Agua', 3000],
    ['02/10/2026', '13:00', 'FB', '0001-00000124', 'Consumidor final', 1000, 0, 1000, '3', 'S', 'EF'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Hoja1');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
  return { buffer, originalname: `ventas.${bookType}` } as Express.Multer.File;
}

describe('RestosoftParser', () => {
  const parser = new RestosoftParser();

  for (const bookType of ['xls', 'xlsx'] as const) {
    it(`lee tickets e ítems de un .${bookType} y saltea anulados`, () => {
      const file = restosoftFile(bookType);
      expect(parser.canParse(file)).toBe(true);
      const report = parser.parse(file);
      expect(report.shopLabel).toBe('Tutto Passa');
      expect(report.tickets).toHaveLength(1);
      const [t] = report.tickets;
      expect(t.externalId).toBe('0001-00000123');
      expect(t.total).toBe(8500);
      expect(t.paymentCode).toBe('EF');
      expect(t.lines.map((l) => [l.productCode, l.qty, l.amount])).toEqual([
        ['P01', 2, 6000],
        ['B02', 1, 3000],
      ]);
    });
  }

  it('no reconoce un Excel cualquiera', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['hola']]), 'H');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    expect(parser.canParse({ buffer } as Express.Multer.File)).toBe(false);
  });
});
