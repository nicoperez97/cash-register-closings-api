import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { ShortageLevel } from '../common/enums';

@Entity({ name: 'shortages' })
@Index('idx_shortages_shop', ['shopId'])
export class Shortage extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** Nada / Poco / Normal / Mucho */
  @Column({ type: 'enum', enum: ShortageLevel, default: ShortageLevel.NORMAL })
  level: ShortageLevel;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
