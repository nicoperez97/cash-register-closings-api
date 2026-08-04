import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { GlobalRole } from '../common/enums';
import { UserShop } from './user-shop.entity';
import { CashClosing } from './cash-closing.entity';

@Entity({ name: 'users' })
export class User extends BaseEntity {
  @Column()
  fullName: string;

  @Column({ unique: true })
  email: string;

  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: GlobalRole, default: GlobalRole.CASHIER })
  globalRole: GlobalRole;

  /** Local preferido al iniciar sesión (debe estar entre los asignados). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  favoriteShopId?: string | null;

  @OneToMany(() => UserShop, (us) => us.user)
  userShops?: UserShop[];

  @OneToMany(() => CashClosing, (c) => c.createdBy)
  closingsCreated?: CashClosing[];
}
