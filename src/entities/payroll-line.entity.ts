import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { PayrollPeriod } from './payroll-period.entity';
import { Employee } from './employee.entity';

@Entity({ name: 'payroll_lines' })
@Unique(['periodId', 'employeeId'])
export class PayrollLine extends BaseEntity {
  @Column()
  periodId: string;

  @Column()
  employeeId: string;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  daysWorked: string;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  holidayDays: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  baseSalarySnapshot: string;

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
