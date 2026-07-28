import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { UserShop } from './user-shop.entity';
import { CashClosing } from './cash-closing.entity';

@Entity({ name: 'shops' })
export class Shop extends BaseEntity {
  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ default: 'America/Montevideo' })
  timezone: string;

  @Column({ default: 'UYU' })
  currency: string;

  @Column({ type: 'varchar', nullable: true })
  unitsLabel?: string | null;

  @Column({ type: 'tinyint', default: 0 })
  coversEnabled: boolean;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  defaultChangeAmount: string;

  /** URL pública del logo del local (sidebar, toolbar, etc.). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  logoUrl?: string | null;

  /** Color de énfasis del local (hex, p.ej. #E65100). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  accentColor?: string | null;

  @OneToMany(() => UserShop, (us) => us.shop)
  userShops?: UserShop[];

  @OneToMany(() => CashClosing, (c) => c.shop)
  closings?: CashClosing[];
}
