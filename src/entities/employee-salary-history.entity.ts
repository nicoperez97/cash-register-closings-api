import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Employee } from './employee.entity';
import { Shop } from './shop.entity';
import { User } from './user.entity';

export enum SalaryHistorySource {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  MIGRATE_DAILY = 'MIGRATE_DAILY',
}

@Entity({ name: 'employee_salary_history' })
export class EmployeeSalaryHistory extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  employeeId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  baseSalary: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  overtimeHourRate: string;

  /** null = heredaba/hereda el del local. */
  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  holidayPayMultiplier?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  previousBaseSalary?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  previousOvertimeHourRate?: string | null;

  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  previousHolidayPayMultiplier?: string | null;

  @Column({ type: 'text', nullable: true })
  note?: string | null;

  @Column({
    type: 'enum',
    enum: SalaryHistorySource,
    default: SalaryHistorySource.UPDATE,
  })
  source: SalaryHistorySource;

  @Column({ type: 'varchar', nullable: true })
  createdByUserId?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdByUserId' })
  createdByUser?: User | null;
}
