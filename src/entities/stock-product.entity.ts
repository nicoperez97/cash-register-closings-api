import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { StockCategory } from './stock-category.entity';

@Entity({ name: 'stock_products' })
@Index('idx_stock_products_shop_kind', ['shopId', 'kind'])
export class StockProduct extends BaseEntity {
  @Column()
  shopId: string;

  /** 'food' | 'beverage' — alimentos vs bebidas. */
  @Column({ type: 'varchar', length: 20, default: 'food' })
  kind: string;

  @Column()
  categoryId: string;

  @Column()
  name: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  quantity: string;

  /** Stock mínimo del producto. */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  minQuantity: string;

  /** Stock máximo (para reponer). 0 = no configurado. */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  maxQuantity: string;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => StockCategory)
  @JoinColumn({ name: 'categoryId' })
  category?: StockCategory;
}
