import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { CashClosing } from './cash-closing.entity';
import { User } from './user.entity';
import { LedgerAccount } from './ledger-account.entity';
import { CashPendingWithdrawalStatus } from '../common/enums';

@Entity({ name: 'cash_pending_withdrawals' })
@Index('IDX_cash_pending_withdrawals_shop_status', ['shopId', 'status'])
@Index('IDX_cash_pending_withdrawals_closing', ['closingId'])
export class CashPendingWithdrawal extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  closingId: string;

  @Column({ type: 'date' })
  businessDate: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  amount: string;

  @Column({
    type: 'enum',
    enum: CashPendingWithdrawalStatus,
    default: CashPendingWithdrawalStatus.PENDING,
  })
  status: CashPendingWithdrawalStatus;

  @Column({ type: 'varchar', nullable: true })
  pickedByUserId?: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  pickedByName?: string | null;

  @Column({ type: 'varchar', nullable: true })
  pickedToAccountId?: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  pickedAt?: Date | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => CashClosing)
  @JoinColumn({ name: 'closingId' })
  closing: CashClosing;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'pickedByUserId' })
  pickedByUser?: User | null;

  @ManyToOne(() => LedgerAccount, { nullable: true })
  @JoinColumn({ name: 'pickedToAccountId' })
  pickedToAccount?: LedgerAccount | null;
}
