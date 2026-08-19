import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { Employee } from './employee.entity';
import { User } from './user.entity';
import { ReimbursementStatus } from '../common/enums';

@Entity({ name: 'reimbursements' })
export class Reimbursement extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  employeeId: string;

  @Column({ type: 'varchar', nullable: true })
  createdByUserId?: string | null;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount: string;

  @Column({ type: 'date' })
  expenseDate: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  /** Alias/CBU al momento de cargar el gasto. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  bankAliasSnapshot?: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: ReimbursementStatus.PENDING,
  })
  status: ReimbursementStatus;

  @Column({ type: 'date', nullable: true })
  paidAt?: string | null;

  @Column({ type: 'varchar', nullable: true })
  paidByUserId?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  receiptFilePath?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  receiptFileName?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  receiptFileMime?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdByUserId' })
  createdBy?: User | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'paidByUserId' })
  paidBy?: User | null;
}
