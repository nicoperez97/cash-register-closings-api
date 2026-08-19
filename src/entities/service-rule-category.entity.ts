import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { ServiceRule } from './service-rule.entity';

@Entity({ name: 'service_rule_categories' })
@Index('idx_src_shop', ['shopId'])
export class ServiceRuleCategory extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @OneToMany(() => ServiceRule, (r) => r.category)
  rules?: ServiceRule[];
}
