import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CashClosing } from './cash-closing.entity';
import { ShopClosingSource } from './shop-closing-source.entity';
import { LedgerAccount } from './ledger-account.entity';
import { ClosingSourceKind } from '../common/enums';

@Entity({ name: 'closing_source_amounts' })
@Index('IDX_closing_source_amounts_closing', ['closingId'])
@Index('IDX_closing_source_amounts_settle_batch', ['settleBatchId'])
export class ClosingSourceAmount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  closingId: string;

  @Column({ type: 'varchar', nullable: true })
  sourceId?: string | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'tinyint', default: 0 })
  includeInDeclared: boolean;

  @Column({
    type: 'enum',
    enum: ClosingSourceKind,
    default: ClosingSourceKind.RECORD_ONLY,
  })
  kind: ClosingSourceKind;

  @Column({ type: 'varchar', nullable: true })
  accountId?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  amount: string;

  /** Desglose opcional; `amount` es la suma. */
  @Column({ type: 'json', nullable: true })
  lines?: number[] | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  settledAt?: Date | null;

  @Column({ type: 'varchar', nullable: true })
  settledToAccountId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  settledByUserId?: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  settledByName?: string | null;

  @Column({ type: 'varchar', nullable: true })
  settlementMovementId?: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  settleBatchId?: string | null;

  @ManyToOne(() => CashClosing, (c) => c.sourceAmounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'closingId' })
  closing: CashClosing;

  @ManyToOne(() => LedgerAccount, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'settledToAccountId' })
  settledToAccount?: LedgerAccount | null;

  @ManyToOne(() => ShopClosingSource, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sourceId' })
  source?: ShopClosingSource | null;
}
