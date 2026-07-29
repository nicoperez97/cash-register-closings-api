import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { ConceptKind } from '../common/enums';

@Entity({ name: 'concepts' })
@Unique(['shopId', 'name'])
export class Concept extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: ConceptKind, default: ConceptKind.EXPENSE })
  kind: ConceptKind;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
