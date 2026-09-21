import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';

export type PrintJobKind = 'CUSTOMER_ORDER' | 'RESERVATION' | 'TEST';
export type PrintJobStatus = 'PENDING' | 'CLAIMED' | 'PRINTED' | 'FAILED';

@Entity({ name: 'print_jobs' })
@Index('idx_print_jobs_shop_status', ['shopId', 'status', 'createdAt'])
@Index('idx_print_jobs_shop_source', ['shopId', 'sourceId'], { unique: true })
@Index('idx_print_jobs_claim_token', ['shopId', 'claimToken'])
export class PrintJob extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 24 })
  kind: PrintJobKind;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status: PrintJobStatus;

  /** Token del lote que reservó el job (GET /jobs). Evita dos PCs imprimiendo lo mismo. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  claimToken?: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  claimedAt?: Date | null;

  /** Idempotencia: p.ej. orderId o reservationId. TEST usa un id único. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  sourceId?: string | null;

  @Column({ type: 'int', default: 1 })
  copies: number;

  /** Intentos de impresión (sube en cada FAILED; a 3 queda FAILED terminal). */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'simple-json' })
  /** Ticket JSON. `printedKeys` = comanderas+sector que ya cortaron (retry parcial). */
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 500, nullable: true })
  error?: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  printedAt?: Date | null;

  @ManyToOne(() => Shop, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shopId' })
  shop?: Shop;
}
