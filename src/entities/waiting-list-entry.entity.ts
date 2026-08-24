import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { ReservationArea } from './reservation.entity';

export enum WaitingListStatus {
  WAITING = 'WAITING',
  READY = 'READY',
  SEATED = 'SEATED',
  CANCELLED = 'CANCELLED',
  LEFT = 'LEFT',
}

@Entity({ name: 'waiting_list_entries' })
@Index('IDX_waiting_list_shop_status', ['shopId', 'status', 'active'])
export class WaitingListEntry extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 120 })
  guestName: string;

  @Column({ type: 'int', default: 2 })
  partySize: number;

  @Column({ type: 'varchar', length: 40, default: '' })
  phone: string;

  @Column({ type: 'varchar', length: 16, default: ReservationArea.INSIDE })
  area: ReservationArea;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  @Column({ type: 'varchar', length: 16, default: WaitingListStatus.WAITING })
  status: WaitingListStatus;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
