import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { Employee } from './employee.entity';

@Entity({ name: 'attendance_days' })
@Index('IDX_attendance_days_shopId', ['shopId'])
@Index('IDX_attendance_days_employeeId', ['employeeId'])
@Unique('uq_attendance_emp_date_shift', ['employeeId', 'date', 'shiftId'])
export class AttendanceDay extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  employeeId: string;

  @Column({ type: 'date' })
  date: string;

  /** Turno del local. Obligatorio cuando el local tiene turnos. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  shiftId?: string | null;

  @Column({ type: 'tinyint', default: 0 })
  isHoliday: boolean;

  @Column({ type: 'tinyint', default: 0 })
  isPresent: boolean;

  /** Hora de entrada del turno (HH:mm). */
  @Column({ type: 'varchar', length: 5, nullable: true })
  checkInAt?: string | null;

  /** Hora de salida / retirada (HH:mm). */
  @Column({ type: 'varchar', length: 5, nullable: true })
  checkOutAt?: string | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
  overtimeHours: string;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;
}
