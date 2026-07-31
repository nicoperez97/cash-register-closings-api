/** Campo de PosSaleDaily / desglose de medios al que se mapea un código de pago del POS. */
export type PosPaymentField =
  | 'cash'
  | 'card'
  | 'mercadoPago'
  | 'delivery'
  | 'transfer'
  | 'accountDni'
  | 'other';

export interface ParsedTicketLine {
  productCode: string | null;
  productName: string | null;
  qty: number;
  amount: number;
}

export interface ParsedTicket {
  businessDate: string; // YYYY-MM-DD
  externalId: string;
  ticketType: string | null;
  total: number;
  subtotal: number;
  discount: number;
  paymentCode: string | null;
  covers: number;
  externalClosingId: string | null;
  occurredAt: string | null;
  lines: ParsedTicketLine[];
}

export interface ParsedSalesReport {
  shopLabel: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  tickets: ParsedTicket[];
}

export interface SalesSystemParser {
  readonly key: string;
  canParse(file: Express.Multer.File, sheetPreview?: string[][]): boolean;
  parse(file: Express.Multer.File): ParsedSalesReport | Promise<ParsedSalesReport>;
}
