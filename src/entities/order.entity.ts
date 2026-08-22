import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { OrderLine } from './order-line.entity';

@Entity({ name: 'orders' })
@Index('idx_orders_shop_date', ['shopId', 'orderDate'])
export class Order extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'date' })
  orderDate: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  invoiceFilePath?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  invoiceFileName?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  invoiceFileMime?: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  createdByUserId?: string | null;

  @Column({ type: 'tinyint', default: 0 })
  stockApplied: boolean;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @OneToMany(() => OrderLine, (line) => line.order)
  lines?: OrderLine[];
}
