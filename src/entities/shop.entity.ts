import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { UserShop } from './user-shop.entity';
import { CashClosing } from './cash-closing.entity';
import { SalesSystem } from './sales-system.entity';
import { ShopPosnet } from '../common/posnet';

/** Mapa código POS → campo de cierre (cash|card|mercadoPago|delivery|transfer|accountDni|other). */
export type PosPaymentMap = Record<string, string>;

@Entity({ name: 'shops' })
export class Shop extends BaseEntity {
  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ default: 'America/Argentina/Buenos_Aires' })
  timezone: string;

  /**
   * Hora de apertura del local (HH:mm).
   * El día laboral corre desde esta hora hasta la misma hora del día siguiente.
   */
  @Column({ type: 'varchar', length: 5, default: '10:00' })
  openingTime: string;

  /**
   * Días de franco del local (0=domingo … 6=sábado, como Date.getDay()).
   */
  @Column({ type: 'simple-json', nullable: true })
  closedWeekdays?: number[] | null;

  @Column({ default: 'ARS' })
  currency: string;

  @Column({ type: 'varchar', nullable: true })
  unitsLabel?: string | null;

  @Column({ type: 'tinyint', default: 0 })
  coversEnabled: boolean;

  /** Si es false, el módulo de reservas no está disponible en este local. */
  @Column({ type: 'tinyint', default: 1 })
  reservationsEnabled: boolean;

  /** Si es false, el módulo de lista de espera no está disponible en este local. */
  @Column({ type: 'tinyint', default: 1 })
  waitingListEnabled: boolean;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  defaultChangeAmount: string;

  /** URL pública del logo del local (sidebar, toolbar, etc.). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  logoUrl?: string | null;

  /** Color de énfasis del local (hex, p.ej. #E65100). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  accentColor?: string | null;

  /** Sistema de ventas / POS del local (Restosoft, etc.). */
  @Column({ type: 'uuid', nullable: true })
  salesSystemId?: string | null;

  /**
   * Mapa de códigos de forma de pago del POS → campos del cierre.
   * Si es null se usan los defaults del parser/sistema.
   */
  @Column({ type: 'simple-json', nullable: true })
  posPaymentMap?: PosPaymentMap | null;

  /**
   * Terminales / posnets del local.
   * Cada uno tiene un tipo (PVS, Mercado Pago, Cuenta DNI) y se carga por separado en el cierre.
   */
  @Column({ type: 'simple-json', nullable: true })
  posnets?: ShopPosnet[] | null;

  @ManyToOne(() => SalesSystem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'salesSystemId' })
  salesSystem?: SalesSystem | null;

  @OneToMany(() => UserShop, (us) => us.shop)
  userShops?: UserShop[];

  @OneToMany(() => CashClosing, (c) => c.shop)
  closings?: CashClosing[];
}
