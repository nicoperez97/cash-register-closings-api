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

  /** Si es false, el formulario público de solicitud de reserva está cerrado. */
  @Column({ type: 'tinyint', default: 1 })
  reservationSignupEnabled: boolean;

  /** Si es false, no se puede pedir mesa adentro. */
  @Column({ type: 'tinyint', default: 1 })
  reservationInsideEnabled: boolean;

  /** Si es false, no se puede pedir mesa afuera. */
  @Column({ type: 'tinyint', default: 1 })
  reservationOutsideEnabled: boolean;

  /** Máximo de personas por reserva adentro. NULL = sin tope. */
  @Column({ type: 'int', nullable: true })
  reservationInsideMaxPartySize?: number | null;

  /** Máximo de personas por reserva afuera. NULL = ilimitado. (columna histórica outsideMin) */
  @Column({ type: 'int', nullable: true })
  reservationOutsideMinPartySize?: number | null;

  /** Si es false, el módulo de lista de espera no está disponible en este local. */
  @Column({ type: 'tinyint', default: 1 })
  waitingListEnabled: boolean;

  /** Si es true, el módulo de propinas está disponible en este local. */
  @Column({ type: 'tinyint', default: 0 })
  tipsEnabled: boolean;

  /** Pantalla pública para que el personal vea su presentismo. */
  @Column({ type: 'tinyint', default: 0 })
  publicAttendanceEnabled: boolean;

  /** Carta pública del local. */
  @Column({ type: 'tinyint', default: 0 })
  menuEnabled: boolean;

  /** Carta publicada (secciones e ítems). */
  @Column({ type: 'simple-json', nullable: true })
  menu?: {
    title?: string | null;
    note?: string | null;
    sections?: Array<{
      name: string;
      items: Array<{
        name: string;
        description?: string | null;
        price?: number | null;
        priceLabel?: string | null;
      }>;
    }>;
  } | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  defaultChangeAmount: string;

  /**
   * Horas por defecto al marcar asistencia en producción.
   */
  @Column({ type: 'decimal', precision: 6, scale: 2, default: 8 })
  productionDefaultHours: string;

  /** URL pública del logo del local (sidebar, toolbar, etc.). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  logoUrl?: string | null;

  /** Color principal del local (hex, p.ej. #E65100). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  accentColor?: string | null;

  /** Color de énfasis / secundario del local (hex). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  accentSecondary?: string | null;

  /** Email del local (remitente de notificaciones por correo). */
  @Column({ type: 'varchar', length: 180, nullable: true })
  email?: string | null;

  /** Usuario de Instagram del local (sin @). */
  @Column({ type: 'varchar', length: 30, nullable: true })
  instagramHandle?: string | null;

  /** Teléfono del local (con código de país). Para WhatsApp a futuro. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  phone?: string | null;

  /**
   * Contraseña SMTP / contraseña de aplicación (p.ej. Gmail).
   * No se expone en la API; solo se indica si está configurada.
   */
  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  emailSmtpPassword?: string | null;

  /** Si es false, no se envían mails de notificación de este local. */
  @Column({ type: 'tinyint', default: 1 })
  emailNotificationsEnabled: boolean;

  /**
   * Tipos de notificación a enviar por mail.
   * null = todos los tipos.
   */
  @Column({ type: 'simple-json', nullable: true })
  emailNotificationTypes?: string[] | null;

  /**
   * Usuarios del local que reciben mails.
   * null = todos los usuarios del local.
   */
  @Column({ type: 'simple-json', nullable: true })
  emailNotificationUserIds?: string[] | null;

  /**
   * Asunto y cuerpo custom por tipo de mail.
   * Placeholders: {shop} {guest} {name} {detail} {title} {body}
   * Vacío / tipo ausente = texto automático.
   */
  @Column({ type: 'simple-json', nullable: true })
  emailMessageTemplates?: Record<string, { subject?: string; body?: string }> | null;

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
