import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CashClosing } from './cash-closing.entity';
import { ExtraLineType } from '../common/enums';

@Entity({ name: 'closing_extra_lines' })
export class ClosingExtraLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  closingId: string;

  @Column({ type: 'enum', enum: ExtraLineType })
  type: ExtraLineType;

  @Column()
  label: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  /** JSON string for tip allocation meta, etc. */
  @Column({ type: 'text', nullable: true })
  meta?: string | null;

  @ManyToOne(() => CashClosing, (c) => c.extraLines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'closingId' })
  closing: CashClosing;
}
