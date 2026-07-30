import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { PosCategory } from './pos-category.entity';

/** Subrubro dentro de un rubro (ej. Pastas dentro de COMIDA). */
@Entity({ name: 'pos_subcategories' })
@Unique(['shopId', 'categoryId', 'name'])
@Index(['shopId', 'categoryId'])
export class PosSubcategory extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  categoryId: string;

  @Column({ length: 128 })
  name: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => PosCategory, (c) => c.subcategories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'categoryId' })
  category: PosCategory;
}
