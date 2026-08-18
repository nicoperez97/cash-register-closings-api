import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { ConceptKind, ConceptCategory } from '../common/enums';

@Entity({ name: 'concepts' })
@Unique(['shopId', 'name'])
export class Concept extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'enum', enum: ConceptKind, default: ConceptKind.EXPENSE })
  kind: ConceptKind;

  /** Empleados / Servicios / Proveedores / Movimientos / Otros (puede haber varias). */
  @Column({ type: 'json', nullable: true })
  categories?: ConceptCategory[] | null;

  /** Si es false, no aparece al cargar movimientos / gasto rápido. */
  @Column({ type: 'tinyint', default: 1 })
  validated: boolean;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
