import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { PayrollPeriod } from './payroll-period.entity';
import { Employee } from './employee.entity';

@Entity({ name: 'payroll_lines' })
@Index('IDX_payroll_lines_periodId', ['periodId'])
@Index('IDX_payroll_lines_employeeId', ['employeeId'])
@Unique('uq_payroll_lines_period_emp_shift', ['periodId', 'employeeId', 'shiftId'])
export class PayrollLine extends BaseEntity {
  @Column()
  periodId: string;

  @Column()
  employeeId: string;

  /**
   * Turno de la línea. '' = liquidación agregada (sin separar turnos).
   */
  @Column({ type: 'varchar', length: 36, default: '' })
  shiftId: string;

  /** Nombre del turno al liquidar (snapshot). */
  @Column({ type: 'varchar', length: 80, nullable: true })
  shiftName?: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  daysWorked: string;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  holidayDays: string;

  /** Snapshot del sueldo diario al liquidar. */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  baseSalarySnapshot: string;

  /** Multiplicador de feriado usado al liquidar. */
  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  holidayMultiplierSnapshot?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  overtimeAmount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  attendanceBonus: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  total: string;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @ManyToOne(() => PayrollPeriod, (p) => p.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'periodId' })
  period: PayrollPeriod;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;
}
