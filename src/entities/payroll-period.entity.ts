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

  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'int' })
  month: number;

  @Column({ type: 'enum', enum: PayrollStatus, default: PayrollStatus.DRAFT })
  status: PayrollStatus;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @OneToMany(() => PayrollLine, (l) => l.period, { cascade: true })
  lines?: PayrollLine[];
}
