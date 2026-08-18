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
import { ClosingSourceKind } from '../common/enums';

@Entity({ name: 'closing_source_amounts' })
@Index('IDX_closing_source_amounts_closing', ['closingId'])
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

  @ManyToOne(() => CashClosing, (c) => c.sourceAmounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'closingId' })
  closing: CashClosing;

  @ManyToOne(() => ShopClosingSource, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sourceId' })
  source?: ShopClosingSource | null;
}
