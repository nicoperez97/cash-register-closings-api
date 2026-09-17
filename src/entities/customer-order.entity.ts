import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';

export enum CustomerOrderStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum CustomerOrderFulfillment {
  TAKEAWAY = 'TAKEAWAY',
  DELIVERY = 'DELIVERY',
  /** Pedido de mostrador (staff); no usa la página pública. */
  COUNTER = 'COUNTER',
  /** Comanda de mesa (mozo); hijo de una table_session. */
  TABLE = 'TABLE',
}

export enum CustomerOrderPaymentMethod {
  CASH = 'CASH',
  TRANSFER = 'TRANSFER',
}

export type CustomerOrderLine = {
  menuItemId: string;
  name: string;
  unitPrice: number;
  qty: number;
  notes?: string | null;
  kind?: 'ITEM' | 'EXTRA' | 'PROMO';
  extraId?: string | null;
  attachedToMenuItemId?: string | null;
  /** Promo de venta (línea cobro o hijos de pack). */
  promoId?: string | null;
  /** Agrupa hijos + línea PROMO de una misma venta. */
  promoBundleKey?: string | null;
  /** Ingredientes pedidos sin (subset de removableIngredients del ítem). */
  removedIngredients?: string[];
};

@Entity({ name: 'customer_orders' })
@Index('idx_customer_orders_shop_created', ['shopId', 'createdAt'])
@Index('idx_customer_orders_shop_code', ['shopId', 'code'], { unique: true })
@Index('idx_customer_orders_shop_status', ['shopId', 'status'])
export class CustomerOrder extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 12 })
  code: string;

  @Column({ type: 'varchar', length: 24, default: CustomerOrderStatus.PENDING })
  status: CustomerOrderStatus;

  @Column({ type: 'varchar', length: 16 })
  fulfillment: CustomerOrderFulfillment;

  @Column({ type: 'simple-json' })
  items: CustomerOrderLine[];

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  subtotal: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  deliveryFee: string;

  /** Descuento aplicado sobre el subtotal (solo mostrador / staff). */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  discountAmount: string;

  /** Etiqueta del descuento, ej. "10%" o "Monto". */
  @Column({ type: 'varchar', length: 40, nullable: true })
  discountLabel?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  total: string;

  @Column({ type: 'varchar', length: 80 })
  firstName: string;

  @Column({ type: 'varchar', length: 80 })
  lastName: string;

  @Column({ type: 'varchar', length: 40 })
  phone: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address?: string | null;

  /** Coordenadas de entrega (requeridas para Deliverate). */
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  deliveryLat?: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  deliveryLng?: string | null;

  /** Altura / street_number para Deliverate. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  deliveryStreetNumber?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  deliveryZoneId?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  deliveryZoneName?: string | null;

  /** Origen externo (ej. deliverate). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  externalSource?: string | null;

  /** ID en el sistema externo (order_id Deliverate). */
  @Column({ type: 'varchar', length: 80, nullable: true })
  externalId?: string | null;

  /** Meta del externo: state, dboy_id, delays, etc. */
  @Column({ type: 'simple-json', nullable: true })
  externalMeta?: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 16 })
  paymentMethod: CustomerOrderPaymentMethod;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  cashAmount?: string | null;

  /** Cuándo se acreditó el cobro (efectivo o transferencia recibida). */
  @Column({ type: 'datetime', precision: 6, nullable: true })
  paymentAccreditedAt?: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  customerNotes?: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  salonTableId?: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  tableSessionId?: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  waiterEmployeeId?: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  acceptedAt?: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  preparingAt?: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  readyAt?: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  outForDeliveryAt?: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  cancelledAt?: Date | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
