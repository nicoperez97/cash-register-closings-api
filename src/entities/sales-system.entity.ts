import { Column, Entity, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity({ name: 'sales_systems' })
@Unique(['code'])
export class SalesSystem extends BaseEntity {
  @Column({ length: 64 })
  code: string;

  @Column()
  name: string;

  /** Clave del parser registrado (ej. restosoft). */
  @Column({ length: 64 })
  parserKey: string;
}
