import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';

@Entity({ name: 'reservation_day_notices' })
@Index('UQ_reservation_day_notices_shop_date', ['shopId', 'businessDate'], {
  unique: true,
})
export class ReservationDayNotice extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'date' })
  businessDate: string;

  @Column({ type: 'text' })
  message: string;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
