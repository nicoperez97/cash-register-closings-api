import { Column, Entity, JoinColumn, ManyToOne, OneToMany, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { LedgerAccountType, LinkedPaymentMethod } from '../common/enums';
import { LedgerAccountUser } from './ledger-account-user.entity';

@Entity({ name: 'ledger_accounts' })
@Unique(['shopId', 'code'])
export class LedgerAccount extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  name: string;

  @Column()
  code: string;

  @Column({ type: 'enum', enum: LedgerAccountType, default: LedgerAccountType.PARTNER })
  type: LedgerAccountType;

  @Column({ type: 'varchar', length: 32, nullable: true })
  linkedPaymentMethod?: LinkedPaymentMethod | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @OneToMany(() => LedgerAccountUser, (l) => l.account)
  userLinks?: LedgerAccountUser[];
}
