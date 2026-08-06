import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';

@Entity({ name: 'stock_categories' })
export class StockCategory extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  name: string;

  /** Cantidad mínima requerida para productos de esta categoría. */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  minQuantity: string;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
