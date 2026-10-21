import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export type CustomerOrderAuditAction =
  | 'ADD'
  | 'REMOVE'
  | 'QTY'
  | 'PRICE'
  | 'EDIT'
  | 'DISCOUNT';

/** Cambio sobre un pedido de cliente ya creado (ítems o descuento). */
@Entity({ name: 'customer_order_audits' })
@Index('idx_co_audits_order', ['shopId', 'customerOrderId', 'createdAt'])
@Index('idx_co_audits_shop_created', ['shopId', 'createdAt'])
export class CustomerOrderAudit extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 36 })
  customerOrderId: string;

  @Column({ type: 'varchar', length: 40 })
  orderCode: string;

  @Column({ type: 'varchar', length: 16 })
  action: CustomerOrderAuditAction;

  @Column({ type: 'int', nullable: true })
  lineIndex?: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  itemName?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  lineKind?: string | null;

  @Column({ type: 'int', nullable: true })
  qtyBefore?: number | null;

  @Column({ type: 'int', nullable: true })
  qtyAfter?: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  unitPriceBefore?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  unitPriceAfter?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  discountBefore?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  discountAfter?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  discountLabelBefore?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  discountLabelAfter?: string | null;

  @Column({ type: 'simple-json', nullable: true })
  payload?: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  actorUserId?: string | null;

  @Column({ type: 'varchar', length: 120 })
  actorName: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  note?: string | null;
}
