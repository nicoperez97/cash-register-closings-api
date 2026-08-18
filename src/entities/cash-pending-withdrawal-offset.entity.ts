import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { CashPendingWithdrawal } from './cash-pending-withdrawal.entity';
import { Movement } from './movement.entity';

/** Gasto de caja imputado a un retiro pendiente (el efectivo ya no está para retirar). */
@Entity({ name: 'cash_pending_withdrawal_offsets' })
@Index('IDX_cash_wd_offsets_pending', ['pendingId'])
@Index('IDX_cash_wd_offsets_movement', ['movementId'])
@Unique('UQ_cash_wd_offsets_pending_movement', ['pendingId', 'movementId'])
export class CashPendingWithdrawalOffset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  shopId: string;

  @Column()
  pendingId: string;

  @Column()
  movementId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  amount: string;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @ManyToOne(() => CashPendingWithdrawal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pendingId' })
  pending: CashPendingWithdrawal;

  @ManyToOne(() => Movement, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'movementId' })
  movement: Movement;
}
