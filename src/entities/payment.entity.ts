import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { User } from './user.entity';
import { LedgerAccount } from './ledger-account.entity';
import { Movement } from './movement.entity';
import { Supplier } from './supplier.entity';
import { Employee } from './employee.entity';
import { ShopService } from './shop-service.entity';
import { PaymentMethod, PaymentPriority, PaymentStatus } from '../common/enums';

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

  /** Baja / media / alta (opcional). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  priority?: PaymentPriority | null;

  @Column({ type: 'varchar', nullable: true })
  payerUserId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  validatorUserId?: string | null;

  /** Cuenta desde la que se paga (egreso). */
  @Column({ type: 'varchar', nullable: true })
  accountId?: string | null;

  /** Efectivo / transferencia / tarjeta / otra. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  paymentMethod?: PaymentMethod | null;

  @Column({ type: 'varchar', nullable: true })
  supplierId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  employeeId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  serviceId?: string | null;

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

  /** Datos de facturación del comprobante del proveedor. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  invoiceLegalName?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  invoiceTaxId?: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  invoiceType?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  invoiceNumber?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  invoiceNetAmount?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  invoiceIvaAmount?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  invoicePerceptionsAmount?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  invoiceOtherTaxesAmount?: string | null;

  /** Path relativo bajo uploads/ del PDF o foto de la factura. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  invoiceFilePath?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  invoiceFileName?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  invoiceFileMime?: string | null;

  /** Path relativo bajo uploads/ del comprobante de pago. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  receiptFilePath?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  receiptFileName?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  receiptFileMime?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'payerUserId' })
  payer?: User | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'validatorUserId' })
  validator?: User | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdByUserId' })
  createdBy?: User | null;

  @ManyToOne(() => LedgerAccount, { nullable: true })
  @JoinColumn({ name: 'accountId' })
  account?: LedgerAccount | null;

  @ManyToOne(() => Supplier, { nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier?: Supplier | null;

  @ManyToOne(() => Employee, { nullable: true })
  @JoinColumn({ name: 'employeeId' })
  employee?: Employee | null;

  @ManyToOne(() => ShopService, { nullable: true })
  @JoinColumn({ name: 'serviceId' })
  service?: ShopService | null;

  @ManyToOne(() => Movement, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'movementId' })
  movement?: Movement | null;
}
