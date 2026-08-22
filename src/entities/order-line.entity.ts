import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Order } from './order.entity';

@Entity({ name: 'order_lines' })
@Index('idx_order_lines_order', ['orderId'])
export class OrderLine extends BaseEntity {
  @Column()
  orderId: string;

  @Column()
  shopId: string;

  /** food | beverage | shortage */
  @Column({ type: 'varchar', length: 20 })
  source: string;

  @Column({ type: 'char', length: 36, nullable: true })
  productId?: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  shortageId?: string | null;

  @Column({ type: 'varchar', length: 200 })
  nameSnapshot: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  quantity: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @ManyToOne(() => Order, (order) => order.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;
}
