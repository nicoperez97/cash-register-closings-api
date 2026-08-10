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

  /**
   * Niveles por módulo para este local.
   * Ej. { closings: 'create', movements: 'manage' }
   * null = migrar desde shopRole en runtime.
   */
  @Column({ type: 'simple-json', nullable: true })
  modulePermissions?: Record<string, string> | null;

  /**
   * Legacy: si es true, no aparece en “Quién se lo lleva”.
   * Preferir `visibility.cashWithdraw` (invertido). Se mantiene sincronizado al guardar.
   */
  @Column({ default: false })
  hideFromCashWithdraw: boolean;

  /**
   * Dónde se muestra el usuario en este local (true = visible).
   * Keys: cashWithdraw, closingsFilters, payments, movements, employeeLink, usersList.
   */
  @Column({ type: 'json', nullable: true })
  visibility?: Record<string, boolean> | null;

  /** Recibe notificaciones cuando un producto de stock alimentos baja del mínimo. */
  @Column({ default: false })
  isStockAdmin: boolean;

  /** Recibe notificaciones cuando un producto de stock bebidas baja del mínimo. */
  @Column({ default: false })
  isBeverageStockAdmin: boolean;

  /** Recibe notificaciones/mails del módulo Faltantes. */
  @Column({ default: false })
  isShortageAdmin: boolean;

  @ManyToOne(() => User, (u) => u.userShops, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Shop, (s) => s.userShops, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
