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

  @Column({ type: 'date', utc: true })
  businessDate: string;

  @Column({ type: 'text' })
  message: string;

  /** NULL = hereda reservationSignupEnabled del local. */
  @Column({ type: 'boolean', nullable: true })
  signupEnabled: boolean | null;

  /** NULL = hereda reservationInsideEnabled del local. */
  @Column({ type: 'boolean', nullable: true })
  insideEnabled: boolean | null;

  /** NULL = hereda reservationOutsideEnabled del local. */
  @Column({ type: 'boolean', nullable: true })
  outsideEnabled: boolean | null;

  /** NULL = sin límite de personas adentro; 0 = sin cupo. */
  @Column({ type: 'int', nullable: true })
  insideCapacityRemaining: number | null;

  /** NULL = sin límite de personas afuera; 0 = sin cupo. */
  @Column({ type: 'int', nullable: true })
  outsideCapacityRemaining: number | null;

  /** NULL = hereda reservationInsideMaxPartySize del local. */
  @Column({ type: 'int', nullable: true })
  insideMaxPartySize: number | null;

  /** NULL = hereda reservationOutsideMinPartySize del local. */
  @Column({ type: 'int', nullable: true })
  outsideMinPartySize: number | null;

  /** NULL = hereda timeRequired del formulario del local. */
  @Column({ type: 'boolean', nullable: true })
  timeRequired: boolean | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
