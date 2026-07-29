import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { Employee } from './employee.entity';

@Entity({ name: 'attendance_days' })
@Unique(['employeeId', 'date'])
export class AttendanceDay extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  employeeId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'tinyint', default: 0 })
  isHoliday: boolean;

  @Column({ type: 'tinyint', default: 0 })
  isPresent: boolean;

  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
  overtimeHours: string;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;
}
