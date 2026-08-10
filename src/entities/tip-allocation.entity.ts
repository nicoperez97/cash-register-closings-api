import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { TipDay } from './tip-day.entity';
import { Employee } from './employee.entity';
import { User } from './user.entity';

@Entity({ name: 'tip_allocations' })
@Unique(['tipDayId', 'employeeId'])
export class TipAllocation extends BaseEntity {
  @Column()
  tipDayId: string;

  @Column()
  employeeId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  amount: string;

  @Column({ type: 'tinyint', default: 0 })
  delivered: boolean;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  deliveredAt?: Date | null;

  @Column({ type: 'varchar', nullable: true })
  deliveredByUserId?: string | null;

  @ManyToOne(() => TipDay, (d) => d.allocations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tipDayId' })
  tipDay: TipDay;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'deliveredByUserId' })
  deliveredBy?: User | null;
}
