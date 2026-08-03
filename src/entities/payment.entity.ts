import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { User } from './user.entity';
import { LedgerAccount } from './ledger-account.entity';
import { Movement } from './movement.entity';
import { Supplier } from './supplier.entity';
import { Employee } from './employee.entity';
import { PaymentStatus } from '../common/enums';

@Entity({ name: 'payments' })
export class Payment extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  amount?: string | null;

  /** Fecha tentativa de pago. */
  @Column({ type: 'date', nullable: true })
  dueDate?: string | null;

  @Column({ type: 'varchar', nullable: true })
  payerUserId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  validatorUserId?: string | null;

  /** Cuenta desde la que se paga (egreso). */
  @Column({ type: 'varchar', nullable: true })
  accountId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  supplierId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  employeeId?: string | null;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING_VALIDATION,
  })
  status: PaymentStatus;

  @Column({ type: 'date', nullable: true })
  paidAt?: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  validatedAt?: Date | null;

  @Column({ type: 'varchar', nullable: true })
  validatedByUserId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  createdByUserId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  movementId?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'payerUserId' })
  payer?: User | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'validatorUserId' })
  validator?: User | null;

  @ManyToOne(() => LedgerAccount, { nullable: true })
  @JoinColumn({ name: 'accountId' })
  account?: LedgerAccount | null;

  @ManyToOne(() => Supplier, { nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier?: Supplier | null;

  @ManyToOne(() => Employee, { nullable: true })
  @JoinColumn({ name: 'employeeId' })
  employee?: Employee | null;

  @ManyToOne(() => Movement, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'movementId' })
  movement?: Movement | null;
}
