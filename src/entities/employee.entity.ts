import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { User } from './user.entity';

@Entity({ name: 'employees' })
export class Employee extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  fullName: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  baseSalary: string;

  @Column({ type: 'varchar', nullable: true })
  userId?: string | null;

  @Column({ type: 'date', nullable: true })
  hireDate?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user?: User | null;
}
