import { Column, Entity, JoinColumn, ManyToOne, OneToMany, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { LedgerAccountType, LinkedPaymentMethod } from '../common/enums';
import { LedgerAccountUser } from './ledger-account-user.entity';

@Entity({ name: 'ledger_accounts' })
@Unique(['shopId', 'code'])
export class LedgerAccount extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  name: string;

  @Column()
  code: string;

  @Column({ type: 'enum', enum: LedgerAccountType, default: LedgerAccountType.PARTNER })
  type: LedgerAccountType;

  @Column({ type: 'varchar', length: 32, nullable: true })
  linkedPaymentMethod?: LinkedPaymentMethod | null;

  /** Si es true, no aparece en el selector de retiro del cierre (“Quién se lo lleva”). */
  @Column({ type: 'tinyint', default: 0 })
  hideFromCashWithdraw: boolean;

  /** Si es false, no aparece al cargar un gasto. */
  @Column({ type: 'tinyint', default: 1 })
  listInExpenses: boolean;

  /** Si es false, no aparece al cargar un ingreso. */
  @Column({ type: 'tinyint', default: 1 })
  listInIncomes: boolean;

  /** Si es false, no aparece en movimientos entre cuentas. */
  @Column({ type: 'tinyint', default: 1 })
  listInTransfers: boolean;

  /** Si es false, no aparece en el panel de Saldos. */
  @Column({ type: 'tinyint', default: 1 })
  listInBalances: boolean;

  /** Se suma al saldo de movimientos (puede ser negativo). */
  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  openingBalance: string;

  /** Comisión % sobre el saldo (0 = sin comisión). En Saldos se muestra el neto. */
  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
  commissionPercent: string;

  /** % de ownership del socio en Divisiones / Equilibrar (solo PARTNER). */
  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
  ownershipPercent: string;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @OneToMany(() => LedgerAccountUser, (l) => l.account)
  userLinks?: LedgerAccountUser[];
}
