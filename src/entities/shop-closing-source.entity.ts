import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { LedgerAccount } from './ledger-account.entity';
import { ClosingSourceKind, ClosingSourceRole } from '../common/enums';
import { SourcePosnet } from '../common/posnet';

/** Cuenta del local para el cierre (PVS, MP, Pedidos Ya, Efectivo…). */
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

  @Column({
    type: 'enum',
    enum: ClosingSourceRole,
    default: ClosingSourceRole.STANDARD,
  })
  role: ClosingSourceRole;

  @Column({ type: 'varchar', nullable: true })
  accountId?: string | null;

  /** Terminales de cobro de esta cuenta (aparecen en el cierre). */
  @Column({ type: 'json', nullable: true })
  posnets?: SourcePosnet[] | null;

  /** Días después del businessDate del cierre hasta la acreditación esperada (solo SETTLE_*). */
  @Column({ type: 'int', default: 0 })
  settlementLagDays: number;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => LedgerAccount, { nullable: true })
  @JoinColumn({ name: 'accountId' })
  account?: LedgerAccount | null;
}
