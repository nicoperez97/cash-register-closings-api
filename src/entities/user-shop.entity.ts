import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';
import { Shop } from './shop.entity';
import { GlobalRole } from '../common/enums';

@Entity({ name: 'user_shops' })
@Unique(['userId', 'shopId'])
export class UserShop {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  shopId: string;

  @Column({ type: 'enum', enum: GlobalRole, nullable: true })
  shopRole?: GlobalRole | null;

  @ManyToOne(() => User, (u) => u.userShops, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Shop, (s) => s.userShops, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
