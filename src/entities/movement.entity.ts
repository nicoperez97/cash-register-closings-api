import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { LedgerAccount } from './ledger-account.entity';
import { Concept } from './concept.entity';
import { CashClosing } from './cash-closing.entity';
import { Employee } from './employee.entity';

@Entity({ name: 'movements' })
export class Movement extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'date' })
  businessDate: string;

  @Column({ type: 'varchar', nullable: true })
  fromAccountId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  toAccountId?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  amountUyu: string;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  usdRate?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  amountUsd?: string | null;

  @Column({ nullable: true })
  conceptId?: string | null;

  @Column({ type: 'tinyint', default: 0 })
  invoiced: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  invoiceNumber?: string | null;

  @Column({ type: 'varchar', nullable: true })
  closingId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  employeeId?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => LedgerAccount, { nullable: true })
  @JoinColumn({ name: 'fromAccountId' })
  fromAccount?: LedgerAccount | null;

  @ManyToOne(() => LedgerAccount, { nullable: true })
  @JoinColumn({ name: 'toAccountId' })
  toAccount?: LedgerAccount | null;

  @ManyToOne(() => Concept, { nullable: true })
  @JoinColumn({ name: 'conceptId' })
  concept?: Concept | null;

  @ManyToOne(() => CashClosing, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'closingId' })
  closing?: CashClosing | null;

  @ManyToOne(() => Employee, { nullable: true })
  @JoinColumn({ name: 'employeeId' })
  employee?: Employee | null;
}
