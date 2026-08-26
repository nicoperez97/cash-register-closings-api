import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity({ name: 'partner_split_runs' })
export class PartnerSplitRun extends BaseEntity {
  @Index()
  @Column()
  shopId: string;

  @Column({ type: 'datetime', precision: 6 })
  appliedAt: Date;

  @Column({ type: 'varchar', nullable: true })
  appliedByUserId?: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  appliedByName?: string | null;

  @Column({ type: 'int', default: 0 })
  transferCount: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  distributedAmount: string;

  @Column({ type: 'json' })
  snapshot: Record<string, unknown>;
}
