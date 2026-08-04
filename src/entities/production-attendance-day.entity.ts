import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { Employee } from './employee.entity';

/** Presentismo de producción (solo empleados que producen comida). */
@Entity({ name: 'production_attendance_days' })
@Unique(['employeeId', 'date'])
export class ProductionAttendanceDay extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  employeeId: string;

  @Column({ type: 'date' })
  date: string;

  /** Horas trabajadas en producción ese día. */
  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
  hours: string;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;
}
