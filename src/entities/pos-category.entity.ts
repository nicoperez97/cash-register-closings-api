import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { PosSubcategory } from './pos-subcategory.entity';

/** Rubro de ventas POS (ej. COMIDA, PIZZA) — nivel usado en comisiones. */
@Entity({ name: 'pos_categories' })
@Unique(['shopId', 'name'])
@Index(['shopId', 'sortOrder'])
export class PosCategory extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ length: 128 })
  name: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @OneToMany(() => PosSubcategory, (s) => s.category)
  subcategories?: PosSubcategory[];
}
