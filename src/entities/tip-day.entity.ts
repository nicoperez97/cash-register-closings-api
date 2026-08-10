import { Column, Entity, JoinColumn, ManyToOne, OneToMany, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { TipAllocation } from './tip-allocation.entity';
import { User } from './user.entity';
import { CashClosing } from './cash-closing.entity';

@Entity({ name: 'tip_days' })
@Unique(['shopId', 'businessDate'])
export class TipDay extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'date' })
  businessDate: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  cashAmount: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  transferAmount: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  ticketsAmount: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalAmount: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  @Column({ type: 'varchar', nullable: true })
  closingId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  createdByUserId?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => CashClosing, { nullable: true })
  @JoinColumn({ name: 'closingId' })
  closing?: CashClosing | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdByUserId' })
  createdBy?: User | null;

  @OneToMany(() => TipAllocation, (a) => a.tipDay)
  allocations: TipAllocation[];
}
