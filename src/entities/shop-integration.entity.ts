import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { ClosingSourceKind } from '../common/enums';
import { BaseEntity } from './base.entity';
import { LedgerAccount } from './ledger-account.entity';
import { Shop } from './shop.entity';
import { ShopClosingSource } from './shop-closing-source.entity';

export type ShopIntegrationProvider = 'deliverate';

export type DeliverateWorkingDay = {
  day: number;
  shifts: Array<'M' | 'N'>;
};

@Entity({ name: 'shop_integrations' })
@Unique('uq_shop_integrations_shop_provider', ['shopId', 'provider'])
@Index('idx_shop_integrations_provider_integration', ['provider', 'integrationId'])
export class ShopIntegration extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: ShopIntegrationProvider;

  @Column({ type: 'tinyint', default: 0 })
  enabled: boolean;

  /** Usuario de integración Deliverate (cuenta padre). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  username?: string | null;

  /** Password de la cuenta de integración (no se expone en API). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  password?: string | null;

  /** id_token de larga duración (post upsertApiKey). */
  @Column({ type: 'text', nullable: true })
  apiToken?: string | null;

  /** Username del shop Deliverate / integration_id. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  integrationId?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  deliId?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  shopZone?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  businessName?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cuit?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  taxType?: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  ivaCondition?: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  gender?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  birthDate?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  ownerName?: string | null;

  /** Dirección legible del local (text_address en Deliverate). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  textAddress?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  cellphone?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  telephone?: string | null;

  @Column({ type: 'simple-json', nullable: true })
  emails?: string[] | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  locationLat?: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  locationLng?: string | null;

  @Column({ type: 'simple-json', nullable: true })
  workingDays?: DeliverateWorkingDay[] | null;

  /** Password del usuario shop Deliverate (alta createIntegrationShop). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  shopPassword?: string | null;

  @Column({ type: 'tinyint', default: 1 })
  testMode: boolean;

  /**
   * Origen público de la API de este local (sin barra final).
   * Ej. https://api.midominio.com — se usa para registrar el webhook en Deliverate.
   */
  @Column({ type: 'varchar', length: 300, nullable: true })
  webhookBaseUrl?: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  webhookRegisteredAt?: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  lastError?: string | null;

  /**
   * Cuenta del local donde impacta Deliverate en el cierre
   * (misma idea que las “fuentes extra”).
   */
  @Column({ type: 'varchar', nullable: true })
  closingAccountId?: string | null;

  /** Qué hacer con el monto en el cierre. */
  @Column({
    type: 'enum',
    enum: ClosingSourceKind,
    default: ClosingSourceKind.RECORD_ONLY,
  })
  closingKind: ClosingSourceKind;

  @Column({ type: 'tinyint', default: 0 })
  closingIncludeInDeclared: boolean;

  /**
   * Medio de pago de los pedidos delivery que van a la fuente Deliverate
   * (ej. Deliverate + efectivo → cuenta «Deliverate Efectivo»).
   */
  @Column({ type: 'varchar', length: 16, default: 'CASH' })
  closingPaymentMethod: 'CASH' | 'TRANSFER';

  /** Fuente extra sincronizada (shop_closing_sources) para el formulario de cierre. */
  @Column({ type: 'varchar', nullable: true })
  closingSourceId?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => LedgerAccount, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'closingAccountId' })
  closingAccount?: LedgerAccount | null;

  @ManyToOne(() => ShopClosingSource, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'closingSourceId' })
  closingSource?: ShopClosingSource | null;
}
