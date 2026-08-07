import { NotificationType, Permission } from '../../common/enums';

export type StockKind = 'food' | 'beverage';

export function parseStockKind(raw?: string | null): StockKind {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'beverage' || v === 'bebidas' || v === 'bebida') return 'beverage';
  return 'food';
}

export function stockLabel(kind: StockKind): string {
  return kind === 'beverage' ? 'bebidas' : 'alimentos';
}

export function stockReadPermission(kind: StockKind): Permission {
  return kind === 'beverage' ? 'beverageStock.read' : 'stock.read';
}

export function stockManagePermission(kind: StockKind): Permission {
  return kind === 'beverage' ? 'beverageStock.manage' : 'stock.manage';
}

export function stockAdminFlag(
  kind: StockKind,
): 'isStockAdmin' | 'isBeverageStockAdmin' {
  return kind === 'beverage' ? 'isBeverageStockAdmin' : 'isStockAdmin';
}

export function stockBelowType(kind: StockKind): NotificationType {
  return kind === 'beverage'
    ? NotificationType.BEVERAGE_STOCK_BELOW_MINIMUM
    : NotificationType.STOCK_BELOW_MINIMUM;
}

export function stockSharedType(kind: StockKind): NotificationType {
  return kind === 'beverage'
    ? NotificationType.BEVERAGE_STOCK_SHARED
    : NotificationType.STOCK_SHARED;
}

export function stockPath(kind: StockKind): '/stock' | '/beverage-stock' {
  return kind === 'beverage' ? '/beverage-stock' : '/stock';
}
