import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { PosSaleTicket } from './pos-sale-ticket.entity';

@Entity({ name: 'pos_sale_ticket_lines' })
export class PosSaleTicketLine extends BaseEntity {
  @Column()
  ticketId: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  productCode?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  productName?: string | null;

  /** Rubro resuelto desde catálogo `pos_products` al importar. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  category?: string | null;

  /** Subrubro denormalizado desde catálogo. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  subcategory?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 3, default: 0 })
  qty: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  amount: string;

  @ManyToOne(() => PosSaleTicket, (t) => t.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: PosSaleTicket;
}
