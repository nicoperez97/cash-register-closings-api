import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { SalonSector } from './salon-sector.entity';

export enum SalonArea {
  INSIDE = 'INSIDE',
  OUTSIDE = 'OUTSIDE',
}

@Entity({ name: 'salon_tables' })
@Index('idx_salon_tables_shop', ['shopId'])
@Index('idx_salon_tables_sector', ['sectorId'])
export class SalonTable extends BaseEntity {
  @Column()
  shopId: string;

  /** Sector de comanda (Mesas / mozos). */
  @Column({ type: 'char', length: 36, nullable: true })
  sectorId?: string | null;

  /** Adentro/Afuera solo para diagrama y reglas de reservas. */
  @Column({ type: 'varchar', length: 16, default: SalonArea.INSIDE })
  area: SalonArea;

  @Column({ type: 'varchar', length: 40, default: '' })
  label: string;

  /** Cubiertos de la mesa física (según ubicación, a veces 2; máximo 3). */
  @Column({ type: 'int', default: 2 })
  seats: number;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  /**
   * true = comanda / Mesas / mozo.
   * false = inventario de Diagrama (reservas); no se edita en Mesas.
   */
  @Column({ type: 'tinyint', default: 1 })
  forWaiter: boolean;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => SalonSector, { nullable: true })
  @JoinColumn({ name: 'sectorId' })
  sector?: SalonSector | null;
}
