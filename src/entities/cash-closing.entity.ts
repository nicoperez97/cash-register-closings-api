import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { User } from './user.entity';
import { ClosingStatus } from '../common/enums';
import { ClosingExpense } from './closing-expense.entity';
import { ClosingExtraLine } from './closing-extra-line.entity';

@Entity({ name: 'cash_closings' })
@Index('IDX_cash_closings_shopId', ['shopId'])
@Unique('uq_shop_date_key', ['shopId', 'businessDateKey'])
export class CashClosing extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'date' })
  businessDate: string;

  /** Clave única (YYYY-MM-DD); en soft-delete pasa a `fecha__DELETED__{id}`. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  businessDateKey: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  posSystemAmount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  cardAmount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  cashAmount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  mercadoPagoAmount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  deliveryAppsAmount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  transferAmount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  accountDniAmount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  otherAmount: string;

  @Column({ type: 'int', nullable: true })
  unitsSold?: number | null;

  @Column({ type: 'int', nullable: true })
  coversCount?: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  averageTicket?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  cashLeftInRegister: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  cashPendingPickup: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  cashWithdrawn: string;

  @Column({ type: 'varchar', nullable: true })
  cashWithdrawnByUserId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  cashWithdrawnByEmployeeId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  cashWithdrawnByName?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  tipsAmount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  declaredTotal: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  calculatedTotal: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  difference: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  differenceReason?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ type: 'varchar', nullable: true })
  evidenceUrl?: string | null;

  @Column({ type: 'enum', enum: ClosingStatus, default: ClosingStatus.DRAFT })
  status: ClosingStatus;

  @Column()
  createdByUserId: string;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  submittedAt?: Date | null;

  @ManyToOne(() => Shop, (s) => s.closings)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'createdByUserId' })
  createdBy: User;

  @OneToMany(() => ClosingExpense, (e) => e.closing, { cascade: true })
  expenses?: ClosingExpense[];

  @OneToMany(() => ClosingExtraLine, (e) => e.closing, { cascade: true })
  extraLines?: ClosingExtraLine[];
}
