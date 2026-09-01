import { Column, Entity, JoinColumn, ManyToOne, OneToMany, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { PayrollStatus } from '../common/enums';
import { PayrollLine } from './payroll-line.entity';

@Entity({ name: 'payroll_periods' })
@Unique(['shopId', 'year', 'month'])
export class PayrollPeriod extends BaseEntity {
  @Column()
  shopId: string;

  /** Año del inicio del período (compat SAC / unique legacy). */
  @Column({ type: 'int' })
  year: number;

  /** Mes del inicio del período (compat SAC / unique legacy). */
  @Column({ type: 'int' })
  month: number;

  /** Inicio inclusivo del período (YYYY-MM-DD). */
  @Column({ type: 'date', nullable: true })
  fromDate?: string | null;

  /** Fin inclusivo del período (YYYY-MM-DD). */
  @Column({ type: 'date', nullable: true })
  toDate?: string | null;

  @Column({ type: 'enum', enum: PayrollStatus, default: PayrollStatus.DRAFT })
  status: PayrollStatus;

  /** Monto del presentismo semanal usado al generar (snapshot del período). */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 50000 })
  attendanceBonusAmount: string;

  /** Legacy: umbral por días (ya no se usa; el presentismo es semanal). */
  @Column({ type: 'int', default: 21 })
  attendanceBonusMinDays: number;

  /** Si la última generación separó líneas por turno. */
  @Column({ type: 'tinyint', default: 0 })
  splitByShift: boolean;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @OneToMany(() => PayrollLine, (l) => l.period, { cascade: true })
  lines?: PayrollLine[];
}
