import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';

@Entity({ name: 'salon_sectors' })
@Index('idx_salon_sectors_shop', ['shopId'])
export class SalonSector extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 60, default: '' })
  name: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
