import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { SalesSystem } from './sales-system.entity';
import { User } from './user.entity';

@Entity({ name: 'pos_sale_imports' })
export class PosSaleImport extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  salesSystemId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fileName?: string | null;

  @Column({ type: 'date', nullable: true })
  periodFrom?: string | null;

  @Column({ type: 'date', nullable: true })
  periodTo?: string | null;

  @Column({ type: 'int', default: 0 })
  ticketCount: number;

  @Column()
  importedByUserId: string;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => SalesSystem)
  @JoinColumn({ name: 'salesSystemId' })
  salesSystem: SalesSystem;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'importedByUserId' })
  importedBy: User;
}
