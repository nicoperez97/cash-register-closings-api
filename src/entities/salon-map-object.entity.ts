import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { SalonSector } from './salon-sector.entity';

/** Decoración / objeto del mapa de comanda (no es mesa). */
@Entity({ name: 'salon_map_objects' })
@Index('idx_salon_map_objects_shop', ['shopId'])
@Index('idx_salon_map_objects_sector', ['sectorId'])
export class SalonMapObject extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'char', length: 36 })
  sectorId: string;

  /** barra | arbol | otro */
  @Column({ type: 'varchar', length: 24, default: 'otro' })
  kind: string;

  @Column({ type: 'varchar', length: 60, default: '' })
  name: string;

  @Column({ type: 'double', default: 50 })
  mapX: number;

  @Column({ type: 'double', default: 50 })
  mapY: number;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => SalonSector)
  @JoinColumn({ name: 'sectorId' })
  sector: SalonSector;
}
