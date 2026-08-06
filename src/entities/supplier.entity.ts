import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { LedgerAccount } from './ledger-account.entity';

@Entity({ name: 'suppliers' })
export class Supplier extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** Razón social (dato fiscal fijo). */
  @Column({ type: 'varchar', length: 200, nullable: true })
  legalName?: string | null;

  /** CUIT / identificación fiscal. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  taxId?: string | null;

  /** Alias o CBU para transferencias. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  bankAlias?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  /** Cuenta contable del proveedor (tipo SUPPLIER, oculta de «quién se lo lleva»). */
  @Column()
  accountId: string;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => LedgerAccount)
  @JoinColumn({ name: 'accountId' })
  account: LedgerAccount;
}
