import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export type ComandaLineAuditAction = 'REMOVE' | 'QTY' | 'PRICE' | 'EDIT';

/** Motivo al quitar o bajar cantidad en el ticket. */
export type ComandaLineReason =
  | 'cortesia'
  | 'error'
  | 'cambio_mesa'
  | 'transfer'
  | 'merma'
  | 'otro';

export const COMANDA_LINE_REASONS: ComandaLineReason[] = [
  'cortesia',
  'error',
  'cambio_mesa',
  'transfer',
  'merma',
  'otro',
];

export type ComandaLineAuditRelated = {
  name: string;
  qty: number;
  unitPrice: number;
  kind?: string;
  qtyAfter?: number | null;
  unitPriceAfter?: number | null;
};

/** Cambio sobre un ítem de comanda ya emitida (envío de mesa). */
@Entity({ name: 'comanda_line_audits' })
@Index('idx_comanda_audits_session', ['shopId', 'tableSessionId', 'createdAt'])
@Index('idx_comanda_audits_shop_created', ['shopId', 'createdAt'])
export class ComandaLineAudit extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 36 })
  tableSessionId: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  salonTableId?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  tableLabel?: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  customerOrderId?: string | null;

  @Column({ type: 'varchar', length: 12 })
  orderCode: string;

  @Column({ type: 'varchar', length: 16 })
  action: ComandaLineAuditAction;

  @Column({ type: 'int' })
  lineIndex: number;

  @Column({ type: 'varchar', length: 200 })
  itemName: string;

  @Column({ type: 'varchar', length: 16, default: 'ITEM' })
  lineKind: string;

  @Column({ type: 'int', nullable: true })
  qtyBefore?: number | null;

  @Column({ type: 'int', nullable: true })
  qtyAfter?: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  unitPriceBefore?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  unitPriceAfter?: string | null;

  /** Extras que viajaron con el ítem (qty/precio o quita). */
  @Column({ type: 'simple-json', nullable: true })
  relatedLines?: ComandaLineAuditRelated[] | null;

  @Column({ type: 'simple-json', nullable: true })
  lineBefore?: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 24 })
  actorTyp: 'waiter' | 'waiter_staff';

  @Column({ type: 'varchar', length: 36, nullable: true })
  actorEmployeeId?: string | null;

  @Column({ type: 'varchar', length: 120 })
  actorName: string;

  /** El envío quedó vacío y se borró. */
  @Column({ type: 'tinyint', default: 0 })
  orderRemoved: boolean;

  @Column({ type: 'varchar', length: 24, nullable: true })
  reason?: ComandaLineReason | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reasonNote?: string | null;
}
