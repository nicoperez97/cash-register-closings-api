import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export type StockAdjustReason = 'merma' | 'cortesia' | 'error' | 'otro';

@Entity({ name: 'stock_adjustments' })
@Index('idx_stock_adjustments_shop_created', ['shopId', 'createdAt'])
export class StockAdjustment extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  productId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  delta: string;

  @Column({ type: 'varchar', length: 24 })
  reason: StockAdjustReason;

  @Column({ type: 'varchar', length: 200, nullable: true })
  note?: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  userId?: string | null;
}
