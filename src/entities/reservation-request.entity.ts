import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { Reservation, ReservationArea } from './reservation.entity';

export enum ReservationRequestStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

@Entity({ name: 'reservation_requests' })
@Index('IDX_reservation_requests_shop_status', ['shopId', 'status'])
export class ReservationRequest extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'date', utc: true })
  businessDate: string;

  @Column({ type: 'varchar', length: 120 })
  guestName: string;

  @Column({ type: 'varchar', length: 180 })
  guestEmail: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  instagramHandle?: string | null;

  @Column({ type: 'int', default: 2 })
  partySize: number;

  /** HH:mm opcional */
  @Column({ type: 'varchar', length: 5, nullable: true })
  reservationTime?: string | null;

  @Column({ type: 'varchar', length: 16, default: ReservationArea.INSIDE })
  area: ReservationArea;

  @Column({ type: 'varchar', length: 400, nullable: true })
  guestComment?: string | null;

  @Column({ type: 'varchar', length: 16, default: ReservationRequestStatus.PENDING })
  status: ReservationRequestStatus;

  @Column({ type: 'varchar', nullable: true })
  reservationId?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  staffNote?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => Reservation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reservationId' })
  reservation?: Reservation | null;
}
