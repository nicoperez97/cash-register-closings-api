import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CashClosing } from './cash-closing.entity';
import { ExpenseCategory } from '../common/enums';

@Entity({ name: 'closing_expenses' })
export class ClosingExpense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  closingId: string;

  @Column()
  label: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'enum', enum: ExpenseCategory, default: ExpenseCategory.OTHER })
  category: ExpenseCategory;

  @ManyToOne(() => CashClosing, (c) => c.expenses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'closingId' })
  closing: CashClosing;
}
