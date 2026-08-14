import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';

export enum SalonArea {
  INSIDE = 'INSIDE',
  OUTSIDE = 'OUTSIDE',
}

@Entity({ name: 'salon_tables' })
@Index('idx_salon_tables_shop', ['shopId'])
export class SalonTable extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 16, default: SalonArea.INSIDE })
  area: SalonArea;

  @Column({ type: 'varchar', length: 40, default: '' })
  label: string;

  /** Cubiertos de la mesa física (según ubicación, a veces 2; máximo 3). */
  @Column({ type: 'int', default: 2 })
  seats: number;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
