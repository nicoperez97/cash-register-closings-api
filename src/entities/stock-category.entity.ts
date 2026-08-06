import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';

@Entity({ name: 'stock_categories' })
export class StockCategory extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  name: string;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
