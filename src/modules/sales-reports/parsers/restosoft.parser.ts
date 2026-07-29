import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import {
  ParsedSalesReport,
  ParsedTicket,
  ParsedTicketLine,
  SalesSystemParser,
} from './sales-system-parser';
import { RESTOSOFT_PARSER_KEY } from '../../../common/sales-systems-seed.service';

function cellStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

function cellNum(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Convierte DD/M/YYYY o D/M/YYYY a YYYY-MM-DD. */
function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = m[1].padStart(2, '0');
  const mo = m[2].padStart(2, '0');
  return `${m[3]}-${mo}-${d}`;
}

function normHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Parser Restosoft — “Consulta de Comprobantes” (.xls / .xlsx).
 * Filas ticket: Fecha + Tipo (string) + Comprobante.
 * Filas ítem: sin fecha, qty/código/nombre en columnas Tipo/Comprobante/Cliente.
 */
export class RestosoftParser implements SalesSystemParser {
  readonly key = RESTOSOFT_PARSER_KEY;

  canParse(file: Express.Multer.File): boolean {
    try {
      const rows = this.readSheet(file);
      const flat = rows.slice(0, 8).map((r) => r.map(cellStr).join(' ').toLowerCase());
      const blob = flat.join('\n');
      return blob.includes('consulta de comprobantes') || blob.includes('formadepago');
    } catch {
      return false;
    }
  }

  parse(file: Express.Multer.File): ParsedSalesReport {
    const rows = this.readSheet(file);
    if (!rows.length) {
      throw new BadRequestException('El archivo está vacío');
    }

    const shopLabel = cellStr(rows[0]?.[0]) || null;
    let periodFrom: string | null = null;
    let periodTo: string | null = null;
    for (let r = 0; r < Math.min(6, rows.length); r++) {
      const label = cellStr(rows[r]?.[0]).toLowerCase();
      if (label.startsWith('periodo')) {
        periodFrom = toIsoDate(cellStr(rows[r]?.[1]));
        periodTo = toIsoDate(cellStr(rows[r]?.[2]));
        break;
      }
    }

    const headerRowIdx = rows.findIndex((r) => {
      const joined = r.map(cellStr).map(normHeader).join('|');
      return joined.includes('formadepago') && joined.includes('comprobante');
    });
    if (headerRowIdx < 0) {
      throw new BadRequestException(
        'No se encontró el encabezado Restosoft (FormaDePago / Comprobante)',
      );
    }

    const headers = rows[headerRowIdx].map((h) => normHeader(cellStr(h)));
    const col = (names: string[]) => {
      for (const n of names) {
        const i = headers.indexOf(n);
        if (i >= 0) return i;
      }
      return -1;
    };

    const iFecha = col(['fecha']);
    const iHora = col(['hora']);
    const iTipo = col(['tipo']);
    const iComp = col(['comprobante']);
    const iCliente = col(['cliente']);
    const iSub = col(['subtotal']);
    const iDesc = col(['descrec', 'desc/rec', 'descre']);
    const iTotal = col(['total']);
    const iCaja = col(['caja']);
    const iAnul = col(['anul']);
    const iIdCierre = col(['idcierre']);
    const iPersonas = col(['cantpersonas']);
    const iPago = col(['formadepago']);

    if (iFecha < 0 || iComp < 0 || iTotal < 0) {
      throw new BadRequestException('Faltan columnas obligatorias (Fecha, Comprobante, Total)');
    }

    const tickets: ParsedTicket[] = [];
    let current: ParsedTicket | null = null;

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const fechaRaw = cellStr(row[iFecha]);
      const tipoRaw = cellStr(row[iTipo]);
      const comp = cellStr(row[iComp]);
      const fechaIso = toIsoDate(fechaRaw);

      // Ticket header: fecha válida + tipo alfanumérico (FA, etc.) + comprobante
      const isTicket =
        !!fechaIso &&
        !!comp &&
        !!tipoRaw &&
        !/^\d+([.,]\d+)?$/.test(tipoRaw);

      if (isTicket) {
        if (current) tickets.push(current);
        const anul = iAnul >= 0 ? cellStr(row[iAnul]) : '';
        if (anul && anul !== '' && anul !== ' ') {
          current = null;
          continue;
        }
        current = {
          businessDate: fechaIso!,
          externalId: comp,
          ticketType: tipoRaw || null,
          total: cellNum(row[iTotal]),
          subtotal: iSub >= 0 ? cellNum(row[iSub]) : 0,
          discount: iDesc >= 0 ? cellNum(row[iDesc]) : 0,
          paymentCode: iPago >= 0 ? cellStr(row[iPago]) || null : null,
          covers: iPersonas >= 0 ? Math.round(cellNum(row[iPersonas])) : 0,
          externalClosingId:
            iIdCierre >= 0
              ? cellStr(row[iIdCierre]) || (iCaja >= 0 ? cellStr(row[iCaja]) : null)
              : iCaja >= 0
                ? cellStr(row[iCaja]) || null
                : null,
          occurredAt: iHora >= 0 ? cellStr(row[iHora]) || null : null,
          lines: [],
        };
        continue;
      }

      // Item line under current ticket
      if (current) {
        const qty = cellNum(row[iTipo]);
        const code = cellStr(row[iComp]);
        const name = iCliente >= 0 ? cellStr(row[iCliente]) : '';
        const amount = iSub >= 0 ? cellNum(row[iSub]) : 0;
        if (!name && !code && !qty && !amount) continue;
        const line: ParsedTicketLine = {
          productCode: code || null,
          productName: name || null,
          qty: qty || 0,
          amount,
        };
        current.lines.push(line);
      }
    }
    if (current) tickets.push(current);

    if (!tickets.length) {
      throw new BadRequestException('No se encontraron comprobantes en el archivo');
    }

    return { shopLabel, periodFrom, periodTo, tickets };
  }

  private readSheet(file: Express.Multer.File): unknown[][] {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo vacío');
    }
    const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: false });
    const name = wb.SheetNames[0];
    if (!name) throw new BadRequestException('El archivo no tiene hojas');
    const sheet = wb.Sheets[name];
    return XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: true,
    }) as unknown[][];
  }
}
