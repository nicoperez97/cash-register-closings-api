import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { LedgerAccount } from './ledger-account.entity';
import { User } from './user.entity';
import { Shop } from './shop.entity';

/** Asociación N:N usuario ↔ cuenta contable (por local). */
@Entity({ name: 'ledger_account_users' })
@Unique(['accountId', 'userId'])
export class LedgerAccountUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  shopId: string;

  @Column()
  accountId: string;

  @Column()
  userId: string;

  @ManyToOne(() => Shop, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => LedgerAccount, (a) => a.userLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account: LedgerAccount;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
