import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';

@Entity({ name: 'stock_categories' })
@Index('idx_stock_categories_shop_kind', ['shopId', 'kind'])
export class StockCategory extends BaseEntity {
  @Column()
  shopId: string;

  /** 'food' | 'beverage' — alimentos vs bebidas. */
  @Column({ type: 'varchar', length: 20, default: 'food' })
  kind: string;

  @Column()
  name: string;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
