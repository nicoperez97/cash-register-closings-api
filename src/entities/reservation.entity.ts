import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';

export enum ReservationArea {
  INSIDE = 'INSIDE',
  OUTSIDE = 'OUTSIDE',
}

export enum ReservationStatus {
  CONFIRMED = 'CONFIRMED',
  SEATED = 'SEATED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

@Entity({ name: 'reservations' })
@Index('IDX_reservations_shop_date', ['shopId', 'businessDate'])
export class Reservation extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'date', utc: true })
  businessDate: string;

  @Column({ type: 'varchar', length: 120, default: '' })
  guestName: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  guestEmail?: string | null;

  @Column({ type: 'int', default: 2 })
  partySize: number;

  @Column({ type: 'varchar', length: 16, default: ReservationArea.INSIDE })
  area: ReservationArea;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  @Column({ type: 'varchar', length: 16, default: ReservationStatus.CONFIRMED })
  status: ReservationStatus;

  /** HH:mm opcional */
  @Column({ type: 'varchar', length: 5, nullable: true })
  reservationTime?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
