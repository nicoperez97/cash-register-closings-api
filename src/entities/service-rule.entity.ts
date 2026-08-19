import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { ServiceRuleCategory } from './service-rule-category.entity';
import { ServiceRulePhase } from '../common/enums';

@Entity({ name: 'service_rules' })
@Index('idx_sr_shop', ['shopId'])
@Index('idx_sr_cat', ['categoryId'])
export class ServiceRule extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  categoryId: string;

  @Column({ type: 'enum', enum: ServiceRulePhase, default: ServiceRulePhase.PRE })
  phase: ServiceRulePhase;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => ServiceRuleCategory, (c) => c.rules)
  @JoinColumn({ name: 'categoryId' })
  category: ServiceRuleCategory;
}
