import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { PosCategory } from './pos-category.entity';
import { PosSubcategory } from './pos-subcategory.entity';

/** Catálogo de platos/productos por local. */
@Entity({ name: 'pos_products' })
@Unique(['shopId', 'productCode'])
@Index(['shopId', 'category'])
@Index(['shopId', 'categoryId'])
export class PosProduct extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ length: 64 })
  productCode: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  productName?: string | null;

  /**
   * Nombre denormalizado del rubro (para reportes/comisiones).
   * Se sincroniza desde `categoryId`.
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  category?: string | null;

  /** Nombre denormalizado del subrubro. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  subcategory?: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  categoryId?: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  subcategoryId?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => PosCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'categoryId' })
  categoryRef?: PosCategory | null;

  @ManyToOne(() => PosSubcategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subcategoryId' })
  subcategoryRef?: PosSubcategory | null;
}
