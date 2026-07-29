import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { SalesSystem } from './sales-system.entity';
import { PosSaleImport } from './pos-sale-import.entity';

@Entity({ name: 'pos_sale_dailies' })
@Unique(['shopId', 'businessDate', 'salesSystemId'])
export class PosSaleDaily extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'date' })
  businessDate: string;

  @Column()
  salesSystemId: string;

  @Column()
  importId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalAmount: string;

  @Column({ type: 'int', default: 0 })
  ticketCount: number;

  @Column({ type: 'int', default: 0 })
  coversCount: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  cashAmount: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  cardAmount: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  mercadoPagoAmount: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  deliveryAppsAmount: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  transferAmount: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  accountDniAmount: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  otherAmount: string;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => SalesSystem)
  @JoinColumn({ name: 'salesSystemId' })
  salesSystem: SalesSystem;

  @ManyToOne(() => PosSaleImport)
  @JoinColumn({ name: 'importId' })
  import: PosSaleImport;
}
