import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { SalonArea } from './salon-table.entity';

@Entity({ name: 'salon_area_rules' })
@Index('idx_salon_area_rules_shop', ['shopId'])
export class SalonAreaRule extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 16, default: SalonArea.INSIDE })
  area: SalonArea;

  /** Tamaño de mesa armada (2, 3, 4, 6…). */
  @Column({ type: 'int' })
  partySize: number;

  /** Cuántas mesas de ese tamaño se pueden armar a la vez. */
  @Column({ type: 'int', default: 0 })
  maxCount: number;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
