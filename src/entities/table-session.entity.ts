import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Employee } from './employee.entity';
import { SalonTable } from './salon-table.entity';
import { Shop } from './shop.entity';

export enum TableSessionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

@Entity({ name: 'table_sessions' })
@Index('idx_table_sessions_shop_status', ['shopId', 'status'])
@Index('idx_table_sessions_table', ['salonTableId'])
export class TableSession extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 36 })
  salonTableId: string;

  /** Null cuando el cliente abre la mesa desde /pedir (sin mozo). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  waiterEmployeeId?: string | null;

  @Column({ type: 'varchar', length: 16, default: TableSessionStatus.OPEN })
  status: TableSessionStatus;

  /**
   * salonTableId mientras la mesa está OPEN; NULL al cerrar.
   * El unique (shopId, openSalonTableId) impide dos sesiones abiertas en la misma mesa.
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  openSalonTableId?: string | null;

  /** Cantidad de comensales al abrir la mesa. */
  @Column({ type: 'int', default: 2 })
  covers: number;

  /** Promo matchable activa en la mesa (legacy; preferir sessionPromos). */
  @Column({ type: 'varchar', length: 40, nullable: true })
  promoId?: string | null;

  /** Cupo de packs (null = ilimitado) — legacy. */
  @Column({ type: 'int', nullable: true })
  promoMaxCount?: number | null;

  /**
   * Promos de mesa (multi).
   * [{ promoId, maxCount }] — maxCount null = ilimitado.
   */
  @Column({ type: 'json', nullable: true })
  sessionPromos?: Array<{ promoId: string; maxCount: number | null }> | null;

  /** Si ya se imprimió al menos un ticket cliente en esta sesión. */
  @Column({ type: 'tinyint', default: 0 })
  customerTicketPrinted: boolean;

  /** Descuento aplicado al ticket cliente (monto). */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  ticketDiscountAmount: string;

  /** Etiqueta del descuento (ej. "10%" o "Desc."). */
  @Column({ type: 'varchar', length: 80, nullable: true })
  ticketDiscountLabel?: string | null;

  /** Total del ticket cliente (subtotal − descuento) al imprimir. */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  ticketTotal?: string | null;

  /** Medio de pago elegido al cerrar (id de tablePaymentMethods). */
  @Column({ type: 'varchar', length: 40, nullable: true })
  paymentMethodId?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  paymentMethodName?: string | null;

  /** Cuenta del local vinculada al medio (snapshot al cerrar). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  paymentAccountId?: string | null;

  /**
   * Pagos al cerrar (puede ser más de uno).
   * [{ paymentMethodId, paymentMethodName, paymentAccountId?, amount }]
   */
  @Column({ type: 'json', nullable: true })
  payments?: Array<{
    paymentMethodId: string;
    paymentMethodName: string;
    paymentAccountId?: string | null;
    amount: number;
  }> | null;

  /** Propina al cerrar (monto final). */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  tipAmount: string;

  /** Etiqueta de propina (ej. "10%" o "Propina"). */
  @Column({ type: 'varchar', length: 80, nullable: true })
  tipLabel?: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  closedAt?: Date | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => SalonTable)
  @JoinColumn({ name: 'salonTableId' })
  salonTable: SalonTable;

  @ManyToOne(() => Employee, { nullable: true })
  @JoinColumn({ name: 'waiterEmployeeId' })
  waiter?: Employee | null;
}
