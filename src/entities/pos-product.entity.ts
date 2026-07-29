import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';

/** Catálogo de platos/productos por local (rubro asignable). */
@Entity({ name: 'pos_products' })
@Unique(['shopId', 'productCode'])
@Index(['shopId', 'category'])
export class PosProduct extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ length: 64 })
  productCode: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  productName?: string | null;

  /** Rubro / categoría (asignado en admin; el export Restosoft no lo trae). */
  @Column({ type: 'varchar', length: 128, nullable: true })
  category?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
