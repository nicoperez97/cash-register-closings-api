import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { LedgerAccount } from './ledger-account.entity';
import { ClosingSourceKind } from '../common/enums';

/** Fuente extra configurable por local (Pedidos Ya, delivery, Ualá…). */
@Entity({ name: 'shop_closing_sources' })
@Index('IDX_shop_closing_sources_shop', ['shopId'])
export class ShopClosingSource extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'tinyint', default: 0 })
  includeInDeclared: boolean;

  @Column({
    type: 'enum',
    enum: ClosingSourceKind,
    default: ClosingSourceKind.RECORD_ONLY,
  })
  kind: ClosingSourceKind;

  @Column({ type: 'varchar', nullable: true })
  accountId?: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => LedgerAccount, { nullable: true })
  @JoinColumn({ name: 'accountId' })
  account?: LedgerAccount | null;
}
