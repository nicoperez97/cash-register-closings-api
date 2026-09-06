import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CashClosing } from './cash-closing.entity';

export const CLOSING_STEP_FILE_SLOTS = [
  'pos_system',
  'channel',
  'posnet',
  'card',
  'mercado_pago',
  'account_dni',
  'other',
] as const;

export type ClosingStepFileSlot = (typeof CLOSING_STEP_FILE_SLOTS)[number];

export function closingStepFileNeedsSource(slot: string): slot is 'channel' | 'posnet' {
  return slot === 'channel' || slot === 'posnet';
}

export function isClosingStepFileSlot(raw: string): raw is ClosingStepFileSlot {
  return (CLOSING_STEP_FILE_SLOTS as readonly string[]).includes(raw);
}

@Entity({ name: 'closing_step_files' })
@Index('IDX_closing_step_files_closing', ['closingId'])
export class ClosingStepFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  closingId: string;

  @Column({ type: 'varchar', length: 24 })
  slot: ClosingStepFileSlot;

  @Column({ type: 'varchar', nullable: true })
  sourceId?: string | null;

  @Column({ type: 'varchar', length: 500 })
  filePath: string;

  @Column({ type: 'varchar', length: 255 })
  fileName: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  fileMime?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  parsedAmount?: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @ManyToOne(() => CashClosing, (c) => c.stepFiles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'closingId' })
  closing: CashClosing;
}
