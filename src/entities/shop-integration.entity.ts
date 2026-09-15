import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';

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

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
