import { Column, Entity, JoinColumn, ManyToOne, OneToMany, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { SalesSystem } from './sales-system.entity';
import { PosSaleImport } from './pos-sale-import.entity';
import { PosSaleTicketLine } from './pos-sale-ticket-line.entity';

@Entity({ name: 'pos_sale_tickets' })
@Unique(['shopId', 'salesSystemId', 'externalId'])
export class PosSaleTicket extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  importId: string;

  @Column()
  salesSystemId: string;

  @Column({ type: 'date' })
  businessDate: string;

  /** Número de comprobante del POS (ej. X-0001-00001293). */
  @Column({ length: 64 })
  externalId: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  ticketType?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  total: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  subtotal: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  discount: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  paymentCode?: string | null;

  @Column({ type: 'int', default: 0 })
  covers: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  externalClosingId?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  occurredAt?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => SalesSystem)
  @JoinColumn({ name: 'salesSystemId' })
  salesSystem: SalesSystem;

  @ManyToOne(() => PosSaleImport)
  @JoinColumn({ name: 'importId' })
  import: PosSaleImport;

  @OneToMany(() => PosSaleTicketLine, (l) => l.ticket)
  lines?: PosSaleTicketLine[];
}
