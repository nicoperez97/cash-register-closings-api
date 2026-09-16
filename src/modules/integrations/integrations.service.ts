import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../../common/decorators';
import { ClosingSourceKind } from '../../common/enums';
import { isGlobalAdmin } from '../../common/guards';
import {
  CustomerOrder,
  CustomerOrderFulfillment,
  CustomerOrderPaymentMethod,
  CustomerOrderStatus,
} from '../../entities/customer-order.entity';
import { LedgerAccount } from '../../entities/ledger-account.entity';
import {
  DeliverateWorkingDay,
  ShopIntegration,
} from '../../entities/shop-integration.entity';
import { ShopClosingSource } from '../../entities/shop-closing-source.entity';
import { Shop } from '../../entities/shop.entity';
import { ShopLiveService } from '../shop-live/shop-live.service';
import { DeliverateClient, DeliverateOrder } from './deliverate.client';
import { UpsertDeliverateConfigDto } from './dto/deliverate.dto';

const DELIVERATE_CLOSING_SOURCE_NAME = 'Deliverate';

@Injectable()
export class IntegrationsService implements OnModuleInit {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @InjectRepository(ShopIntegration)
    private readonly integrations: Repository<ShopIntegration>,
    @InjectRepository(CustomerOrder)
    private readonly orders: Repository<CustomerOrder>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(ShopClosingSource)
    private readonly closingSources: Repository<ShopClosingSource>,
    private readonly deliverate: DeliverateClient,
    private readonly live: ShopLiveService,
  ) {}

  async onModuleInit() {
    try {
      await this.integrations.query(`
        CREATE TABLE IF NOT EXISTS shop_integrations (
          id CHAR(36) NOT NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          shopId CHAR(36) NOT NULL,
          provider VARCHAR(32) NOT NULL,
          enabled TINYINT(1) NOT NULL DEFAULT 0,
          username VARCHAR(120) NULL,
          password VARCHAR(255) NULL,
          apiToken TEXT NULL,
          integrationId VARCHAR(120) NULL,
          deliId VARCHAR(80) NULL,
          shopZone VARCHAR(40) NULL,
          businessName VARCHAR(120) NULL,
          cuit VARCHAR(20) NULL,
          taxType VARCHAR(16) NULL,
          ivaCondition VARCHAR(8) NULL,
          gender VARCHAR(8) NULL,
          birthDate VARCHAR(20) NULL,
          ownerName VARCHAR(120) NULL,
          textAddress VARCHAR(255) NULL,
          cellphone VARCHAR(40) NULL,
          telephone VARCHAR(40) NULL,
          emails TEXT NULL,
          locationLat DECIMAL(10,7) NULL,
          locationLng DECIMAL(10,7) NULL,
          workingDays TEXT NULL,
          shopPassword VARCHAR(255) NULL,
          testMode TINYINT(1) NOT NULL DEFAULT 1,
          webhookBaseUrl VARCHAR(300) NULL,
          webhookRegisteredAt DATETIME(6) NULL,
          lastError VARCHAR(500) NULL,
          closingAccountId CHAR(36) NULL,
          closingKind VARCHAR(32) NOT NULL DEFAULT 'RECORD_ONLY',
          closingIncludeInDeclared TINYINT(1) NOT NULL DEFAULT 0,
          closingPaymentMethod VARCHAR(16) NOT NULL DEFAULT 'CASH',
          closingSourceId CHAR(36) NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_shop_integrations_shop_provider (shopId, provider),
          KEY idx_shop_integrations_provider_integration (provider, integrationId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch {
      /* already exists */
    }

    for (const sql of [
      `ALTER TABLE shop_integrations ADD COLUMN webhookBaseUrl VARCHAR(300) NULL`,
      `ALTER TABLE shop_integrations ADD COLUMN textAddress VARCHAR(255) NULL`,
      `ALTER TABLE shop_integrations ADD COLUMN closingAccountId CHAR(36) NULL`,
      `ALTER TABLE shop_integrations ADD COLUMN closingKind VARCHAR(32) NOT NULL DEFAULT 'RECORD_ONLY'`,
      `ALTER TABLE shop_integrations ADD COLUMN closingIncludeInDeclared TINYINT(1) NOT NULL DEFAULT 0`,
      `ALTER TABLE shop_integrations ADD COLUMN closingSourceId CHAR(36) NULL`,
      `ALTER TABLE shop_integrations ADD COLUMN closingPaymentMethod VARCHAR(16) NOT NULL DEFAULT 'CASH'`,
      `ALTER TABLE customer_orders ADD COLUMN deliveryLat DECIMAL(10,7) NULL`,
      `ALTER TABLE customer_orders ADD COLUMN deliveryLng DECIMAL(10,7) NULL`,
      `ALTER TABLE customer_orders ADD COLUMN deliveryStreetNumber VARCHAR(40) NULL`,
      `ALTER TABLE customer_orders ADD COLUMN externalSource VARCHAR(32) NULL`,
      `ALTER TABLE customer_orders ADD COLUMN externalId VARCHAR(80) NULL`,
      `ALTER TABLE customer_orders ADD COLUMN externalMeta TEXT NULL`,
    ]) {
      try {
        await this.orders.query(sql);
      } catch {
        /* already exists */
      }
    }
  }

  private assertShopAccess(user: AuthUser, shopId: string) {
    if (isGlobalAdmin(user.globalRole as any)) return;
    if (!(user.shopIds ?? []).includes(shopId)) {
      throw new NotFoundException('Local no encontrado');
    }
  }

  private normalizeBaseUrl(raw?: string | null): string | null {
    const value = String(raw ?? '').trim().replace(/\/+$/, '');
    if (!value) return null;
    if (!/^https?:\/\//i.test(value)) {
      throw new BadRequestException(
        'La URL pública de la API debe empezar con http:// o https://',
      );
    }
    return value.slice(0, 300);
  }

  /** Webhook Deliverate de este local (config por shop, sin env global). */
  private webhookUrlFor(row: ShopIntegration): string {
    const origin = this.normalizeBaseUrl(row.webhookBaseUrl);
    if (!origin) {
      throw new BadRequestException(
        'Indicá la URL pública de la API de este local para registrar el webhook',
      );
    }
    return `${origin}/api/v1/webhooks/deliverate`;
  }

  private async getOrCreate(shopId: string): Promise<ShopIntegration> {
    let row = await this.integrations.findOne({
      where: { shopId, provider: 'deliverate' },
    });
    if (!row) {
      row = await this.integrations.save(
        this.integrations.create({
          shopId,
          provider: 'deliverate',
          enabled: false,
          testMode: true,
        }),
      );
    }
    return row;
  }

  async toPublicConfig(row: ShopIntegration) {
    const base = (() => {
      try {
        return this.normalizeBaseUrl(row.webhookBaseUrl);
      } catch {
        return String(row.webhookBaseUrl ?? '').trim().replace(/\/+$/, '') || null;
      }
    })();
    let closingAccountName: string | null = null;
    if (row.closingAccountId) {
      const acc = await this.accounts.findOne({
        where: { id: row.closingAccountId, shopId: row.shopId },
      });
      closingAccountName = acc?.name ?? null;
    }
    return {
      provider: 'deliverate' as const,
      enabled: !!row.enabled,
      connected: !!(
        row.apiToken &&
        row.integrationId &&
        String(row.integrationId).trim().toLowerCase() !==
          String(row.username ?? '')
            .trim()
            .toLowerCase()
      ),
      shopCreated: !!(
        row.deliId ||
        (row.integrationId &&
          String(row.integrationId).trim().toLowerCase() !==
            String(row.username ?? '')
              .trim()
              .toLowerCase())
      ),
      hasCredentials: !!(row.username && row.password),
      hasApiToken: !!row.apiToken,
      username: row.username ?? null,
      integrationId: row.integrationId ?? null,
      deliId: row.deliId ?? null,
      shopZone: row.shopZone ?? null,
      businessName: row.businessName ?? null,
      cuit: row.cuit ?? null,
      taxType: row.taxType ?? null,
      ivaCondition: row.ivaCondition ?? null,
      gender: row.gender ?? null,
      birthDate: row.birthDate ?? null,
      ownerName: row.ownerName ?? null,
      textAddress: row.textAddress ?? null,
      cellphone: row.cellphone ?? null,
      telephone: row.telephone ?? null,
      emails: row.emails ?? null,
      locationLat: row.locationLat == null ? null : Number(row.locationLat),
      locationLng: row.locationLng == null ? null : Number(row.locationLng),
      workingDays: row.workingDays ?? null,
      testMode: !!row.testMode,
      webhookBaseUrl: base,
      webhookRegisteredAt: row.webhookRegisteredAt ?? null,
      lastError: row.lastError ?? null,
      webhookUrlHint: base ? `${base}/api/v1/webhooks/deliverate` : null,
      closingAccountId: row.closingAccountId ?? null,
      closingAccountName,
      closingKind: row.closingKind ?? ClosingSourceKind.RECORD_ONLY,
      closingIncludeInDeclared: !!row.closingIncludeInDeclared,
      closingPaymentMethod:
        row.closingPaymentMethod === 'TRANSFER' ? ('TRANSFER' as const) : ('CASH' as const),
      closingSourceId: row.closingSourceId ?? null,
    };
  }

  /** Config de cierre Deliverate para armar el resumen de pedidos. */
  async getDeliverateClosingHint(shopId: string): Promise<{
    closingSourceId: string | null;
    paymentMethod: 'CASH' | 'TRANSFER';
    includeInDeclared: boolean;
  } | null> {
    const row = await this.integrations.findOne({
      where: { shopId, provider: 'deliverate' },
    });
    if (!row?.closingSourceId) return null;
    return {
      closingSourceId: row.closingSourceId,
      paymentMethod: row.closingPaymentMethod === 'TRANSFER' ? 'TRANSFER' : 'CASH',
      includeInDeclared: !!row.closingIncludeInDeclared,
    };
  }

  async getDeliverateConfig(user: AuthUser, shopId: string) {
    this.assertShopAccess(user, shopId);
    const row = await this.getOrCreate(shopId);
    return await this.toPublicConfig(row);
  }

  async isDeliverateEnabled(shopId: string): Promise<boolean> {
    const row = await this.integrations.findOne({
      where: { shopId, provider: 'deliverate' },
    });
    return !!(row?.enabled && row.apiToken && row.integrationId);
  }

  async upsertDeliverateConfig(
    user: AuthUser,
    shopId: string,
    dto: UpsertDeliverateConfigDto,
    opts?: { requestApiOrigin?: string | null },
  ) {
    this.assertShopAccess(user, shopId);
    const shop = await this.shops.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');

    const row = await this.getOrCreate(shopId);

    if (dto.enabled !== undefined) row.enabled = !!dto.enabled;
    if (dto.testMode !== undefined) row.testMode = !!dto.testMode;
    if (dto.username !== undefined) {
      row.username = String(dto.username ?? '').trim().slice(0, 120) || null;
    }
    if (dto.password !== undefined && dto.password !== null && String(dto.password).length) {
      row.password = String(dto.password).slice(0, 255);
    }
    if (dto.integrationId !== undefined) {
      row.integrationId =
        String(dto.integrationId ?? '').trim().slice(0, 120) || null;
    }
    if (dto.shopPassword !== undefined && dto.shopPassword !== null && String(dto.shopPassword).length) {
      row.shopPassword = String(dto.shopPassword).slice(0, 255);
    }
    if (dto.shopZone !== undefined) row.shopZone = dto.shopZone ?? null;
    if (dto.businessName !== undefined) {
      row.businessName =
        String(dto.businessName ?? '').trim().slice(0, 120) || null;
    }
    if (dto.cuit !== undefined) {
      row.cuit = String(dto.cuit ?? '').replace(/\D/g, '').slice(0, 20) || null;
    }
    if (dto.taxType !== undefined) row.taxType = dto.taxType ?? null;
    if (dto.ivaCondition !== undefined) row.ivaCondition = dto.ivaCondition ?? null;
    if (dto.gender !== undefined) row.gender = dto.gender ?? null;
    if (dto.birthDate !== undefined) {
      row.birthDate = String(dto.birthDate ?? '').trim().slice(0, 20) || null;
    }
    if (dto.ownerName !== undefined) {
      row.ownerName = String(dto.ownerName ?? '').trim().slice(0, 120) || null;
    }
    if (dto.textAddress !== undefined) {
      row.textAddress = String(dto.textAddress ?? '').trim().slice(0, 255) || null;
    }
    if (dto.cellphone !== undefined) {
      row.cellphone = String(dto.cellphone ?? '').replace(/\D/g, '').slice(0, 40) || null;
    }
    if (dto.telephone !== undefined) {
      row.telephone = String(dto.telephone ?? '').replace(/\D/g, '').slice(0, 40) || null;
    }
    if (dto.emails !== undefined) {
      row.emails = (dto.emails ?? [])
        .map((e) => String(e).trim())
        .filter(Boolean)
        .slice(0, 5);
    }
    if (dto.locationLat !== undefined) {
      row.locationLat =
        dto.locationLat == null || !Number.isFinite(Number(dto.locationLat))
          ? null
          : Number(dto.locationLat).toFixed(7);
    }
    if (dto.locationLng !== undefined) {
      row.locationLng =
        dto.locationLng == null || !Number.isFinite(Number(dto.locationLng))
          ? null
          : Number(dto.locationLng).toFixed(7);
    }
    if (dto.workingDays !== undefined) {
      row.workingDays = (dto.workingDays ?? []) as DeliverateWorkingDay[];
    }
    if (dto.webhookBaseUrl !== undefined) {
      row.webhookBaseUrl = this.normalizeBaseUrl(dto.webhookBaseUrl);
    } else if (dto.connect && !row.webhookBaseUrl && opts?.requestApiOrigin) {
      row.webhookBaseUrl = this.normalizeBaseUrl(opts.requestApiOrigin);
    }

    if (dto.closingKind !== undefined) {
      row.closingKind = dto.closingKind;
    }
    if (dto.closingIncludeInDeclared !== undefined) {
      row.closingIncludeInDeclared = !!dto.closingIncludeInDeclared;
    }
    if (dto.closingPaymentMethod !== undefined) {
      row.closingPaymentMethod =
        dto.closingPaymentMethod === 'TRANSFER' ? 'TRANSFER' : 'CASH';
    }
    if (dto.closingAccountId !== undefined) {
      const accountId = dto.closingAccountId ? String(dto.closingAccountId).trim() : '';
      if (!accountId) {
        row.closingAccountId = null;
      } else {
        const acc = await this.accounts.findOne({
          where: { id: accountId, shopId },
        });
        if (!acc) throw new BadRequestException('La cuenta elegida no pertenece a este local');
        row.closingAccountId = acc.id;
      }
    }

    const kind = row.closingKind ?? ClosingSourceKind.RECORD_ONLY;
    const needsAccount =
      kind === ClosingSourceKind.OWN_ACCOUNT || kind === ClosingSourceKind.SETTLE_ACCOUNT;
    if (needsAccount && !row.closingAccountId) {
      throw new BadRequestException(
        'Elegí la cuenta del local para Deliverate (o cambiá el tipo a solo registrar / rinde en efectivo)',
      );
    }
    if (!needsAccount && kind === ClosingSourceKind.SETTLE_CASH) {
      row.closingAccountId = null;
    }
    if (kind === ClosingSourceKind.RECORD_ONLY) {
      row.closingAccountId = null;
    }

    row.lastError = null;

    try {
      if (dto.connect) {
        await this.connectDeliverate(row);
      }
      if (dto.createShop) {
        await this.createDeliverateShop(row, shop);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      row.lastError = msg.slice(0, 500);
      await this.integrations.save(row);
      throw err;
    }

    await this.syncDeliverateClosingSource(row);
    await this.integrations.save(row);
    return await this.toPublicConfig(row);
  }

  /** Crea/actualiza la fuente extra “Deliverate” para el formulario de cierre. */
  private async syncDeliverateClosingSource(row: ShopIntegration): Promise<void> {
    const kind = row.closingKind ?? ClosingSourceKind.RECORD_ONLY;
    const needsAccount =
      kind === ClosingSourceKind.OWN_ACCOUNT || kind === ClosingSourceKind.SETTLE_ACCOUNT;
    const accountId = needsAccount ? row.closingAccountId ?? null : null;

    let source: ShopClosingSource | null = null;
    if (row.closingSourceId) {
      source = await this.closingSources.findOne({
        where: { id: row.closingSourceId, shopId: row.shopId },
      });
    }
    if (!source) {
      source = await this.closingSources.findOne({
        where: { shopId: row.shopId, name: DELIVERATE_CLOSING_SOURCE_NAME },
      });
    }
    if (!source) {
      source = this.closingSources.create({
        shopId: row.shopId,
        name: DELIVERATE_CLOSING_SOURCE_NAME,
        sortOrder: 90,
      });
    }

    source.name = DELIVERATE_CLOSING_SOURCE_NAME;
    source.kind = kind;
    source.accountId = accountId;
    source.includeInDeclared = !!row.closingIncludeInDeclared;
    source = await this.closingSources.save(source);

    row.closingSourceId = source.id;
    row.closingAccountId = accountId;
  }

  private async connectDeliverate(row: ShopIntegration) {
    const username = String(row.username ?? '').trim();
    const password = String(row.password ?? '');
    if (!username || !password) {
      throw new BadRequestException('Ingresá usuario y contraseña de integración Deliverate');
    }
    const auth = await this.deliverate.authenticate(username, password);
    if (!auth?.id_token) {
      throw new BadRequestException('Deliverate no devolvió id_token');
    }
    // Según docs Deliverate, authenticate / upsertApiKey suelen devolver shops: [].
    // La vinculación del comercio es createIntegrationShop (deli_id + integration_id), no esa lista.
    const linkedShops = this.extractShopUsernames(auth.shops);
    this.logger.log(
      `Deliverate connect user=${auth.username ?? username} is_integration=${!!auth.is_integration} shops=[${linkedShops.join(',')}]`,
    );
    const webhook = this.webhookUrlFor(row);
    const key = await this.deliverate.upsertApiKey(
      auth.id_token,
      webhook,
      `CRC shop ${row.shopId}`,
    );
    row.apiToken = key.id_token || auth.id_token;
    row.webhookRegisteredAt = new Date();
    row.lastError = null;

    const wanted = String(row.integrationId ?? '').trim().toLowerCase();
    if (
      wanted &&
      linkedShops.length &&
      !linkedShops.some((s) => s.toLowerCase() === wanted)
    ) {
      this.logger.warn(
        `integration_id="${row.integrationId}" no está en shops=[${linkedShops.join(',')}] (informativo; shops vacío es normal)`,
      );
    }
  }

  private async createDeliverateShop(row: ShopIntegration, shop: Shop) {
    if (!row.apiToken) {
      throw new BadRequestException('Conectá Deliverate antes de crear el comercio');
    }
    const parentUser = String(row.username ?? '').trim().toLowerCase();
    const integrationId = String(row.integrationId ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '')
      .slice(0, 40);
    if (!integrationId) {
      throw new BadRequestException(
        'Definí un usuario shop distinto (integration_id), ej. alpanino',
      );
    }
    if (parentUser && integrationId === parentUser) {
      throw new BadRequestException(
        'El usuario shop no puede ser el mismo que la cuenta de integración. Usá otro, ej. alpanino',
      );
    }
    const shopPassword = String(row.shopPassword ?? '').trim();
    if (!shopPassword) {
      throw new BadRequestException('Definí la contraseña del comercio en Deliverate');
    }
    const ownerName = String(row.ownerName ?? '').trim();
    if (ownerName.length < 2) {
      throw new BadRequestException('Completá el titular (nombre y apellido)');
    }
    const textAddress = String(row.textAddress ?? '').trim();
    if (textAddress.length < 5) {
      throw new BadRequestException('Completá la dirección del local (calle y número)');
    }
    const businessName = String(row.businessName ?? shop.name ?? '').trim();
    if (businessName.length < 2) {
      throw new BadRequestException('Completá el nombre comercial');
    }
    const cellphone = String(row.cellphone ?? row.telephone ?? '').replace(/\D/g, '');
    const telephone = String(row.telephone ?? row.cellphone ?? '').replace(/\D/g, '');
    if (cellphone.length < 8 && telephone.length < 8) {
      throw new BadRequestException('Completá celular o teléfono del local (mín. 8 dígitos)');
    }
    const cuitDigits = String(row.cuit ?? '').replace(/\D/g, '');
    if (cuitDigits.length < 8) {
      throw new BadRequestException('Completá el CUIT del comercio');
    }
    const emails = (row.emails ?? []).map((e) => String(e).trim()).filter(Boolean);
    if (!emails.length) {
      throw new BadRequestException('Agregá al menos un email del comercio');
    }
    const lat = Number(row.locationLat);
    const lng = Number(row.locationLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('Definí la ubicación (lat/lng) del local');
    }
    if (!row.shopZone) {
      throw new BadRequestException('Elegí la zona Deliverate (La Plata, Gonnet o City Bell)');
    }
    const taxType = row.taxType || 'juridica';
    const payload: Record<string, unknown> = {
      username: integrationId,
      password: shopPassword,
      // typo oficial de la API Deliverate
      bussiness_name: businessName,
      cellphone: cellphone || telephone,
      cuit: Number(cuitDigits),
      email: emails.slice(0, 5),
      // La API valida "fullname" (minúscula).
      fullname: ownerName,
      text_address: textAddress,
      location: { coordinates: [lat, lng], type: 'Point' },
      shop_zone: row.shopZone,
      tax_type: taxType,
      telephone: telephone || cellphone,
      working_days: row.workingDays?.length
        ? row.workingDays
        : [
            { day: 1, shifts: ['M', 'N'] },
            { day: 2, shifts: ['M', 'N'] },
            { day: 3, shifts: ['M', 'N'] },
            { day: 4, shifts: ['M', 'N'] },
            { day: 5, shifts: ['M', 'N'] },
            { day: 6, shifts: ['M', 'N'] },
          ],
    };
    if (taxType === 'fisica') {
      if (!row.birthDate || !row.ivaCondition || !row.gender) {
        throw new BadRequestException(
          'Para persona física hacé falta nacimiento, condición IVA y género',
        );
      }
      payload.birth_date = row.birthDate;
      payload.iva_condition = row.ivaCondition;
      payload.gender = row.gender;
    }

    this.logger.log(
      `Deliverate createIntegrationShop user=${integrationId} nameLen=${ownerName.length} keys=${Object.keys(payload).join(',')}`,
    );

    const bodyJson = JSON.stringify(payload);
    this.logger.debug(
      `Deliverate createIntegrationShop body preview: ${bodyJson.slice(0, 280)}`,
    );

    try {
      const created = await this.deliverate.createIntegrationShop(row.apiToken, payload);
      row.integrationId = created.integration_id || integrationId;
      row.deliId = created.deli_id ?? row.deliId ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Typo oficial: "Intregration Shop already exists"
      // Si Deliverate ya dio de alta el shop, lo vinculamos (no hace falta recrearlo).
      if (/already exists/i.test(msg) || /ya existe/i.test(msg)) {
        this.logger.warn(
          `Deliverate shop "${integrationId}" ya existe; vinculamos integration_id`,
        );
        row.integrationId = integrationId;
        return;
      }
      throw err;
    }
  }

  /**
   * Tokens candidatos para createOrder / updateOrder (en orden).
   * 1) Login fresco de la cuenta de integración
   * 2) Token largo (upsertApiKey)
   * 3) Login del usuario shop (si la password es la correcta)
   */
  private async tokensForOrders(row: ShopIntegration): Promise<string[]> {
    const tokens: string[] = [];
    const push = (t?: string | null) => {
      const v = String(t ?? '').trim();
      if (v && !tokens.includes(v)) tokens.push(v);
    };

    const parentUser = String(row.username ?? '').trim();
    const parentPass = String(row.password ?? '').trim();
    if (parentUser && parentPass) {
      try {
        const auth = await this.deliverate.authenticate(parentUser, parentPass);
        push(auth?.id_token);
        const shopNames = this.extractShopUsernames(auth?.shops);
        this.logger.log(
          `Deliverate auth integración ok user=${auth?.username ?? parentUser} is_integration=${!!auth?.is_integration} shops=[${shopNames.join(',')}]`,
        );
        if (
          shopNames.length &&
          row.integrationId &&
          !shopNames.some(
            (s) => s.toLowerCase() === String(row.integrationId).trim().toLowerCase(),
          )
        ) {
          this.logger.warn(
            `integration_id="${row.integrationId}" no está en shops de la cuenta (${shopNames.join(', ') || 'vacío'})`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Deliverate auth integración falló: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    push(row.apiToken);

    const shopUser = String(row.integrationId ?? '').trim();
    const shopPass = String(row.shopPassword ?? '').trim();
    if (shopUser && shopPass) {
      try {
        const auth = await this.deliverate.authenticate(shopUser, shopPass);
        push(auth?.id_token);
        this.logger.log(
          `Deliverate auth shop ok user=${auth?.username ?? shopUser} is_integration=${!!auth?.is_integration}`,
        );
      } catch (err) {
        this.logger.warn(
          `Deliverate auth shop "${shopUser}" falló: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!tokens.length) {
      throw new BadRequestException(
        'Falta token Deliverate. Conectá la cuenta de integración y/o cargá la password del shop.',
      );
    }
    return tokens;
  }

  private extractShopUsernames(shops: unknown): string[] {
    if (!Array.isArray(shops)) return [];
    const out: string[] = [];
    for (const item of shops) {
      if (typeof item === 'string' && item.trim()) {
        out.push(item.trim());
        continue;
      }
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        for (const key of ['username', 'integration_id', 'name', 'shop_username']) {
          const v = o[key];
          if (typeof v === 'string' && v.trim()) {
            out.push(v.trim());
            break;
          }
        }
      }
    }
    return out;
  }

  async testDeliverate(user: AuthUser, shopId: string) {
    this.assertShopAccess(user, shopId);
    const row = await this.getOrCreate(shopId);
    if (!row.username || !row.password) {
      throw new BadRequestException('Faltan credenciales de integración');
    }
    try {
      const auth = await this.deliverate.authenticate(row.username, row.password);
      const shops = this.extractShopUsernames(auth?.shops);
      row.lastError = null;
      await this.integrations.save(row);
      return {
        ok: true,
        username: auth.username ?? row.username,
        isIntegration: !!auth.is_integration,
        hasToken: !!auth.id_token,
        shops,
        // shops [] es normal en auth/upsert; no es un error de vinculación.
        warning: null as string | null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      row.lastError = msg.slice(0, 500);
      await this.integrations.save(row);
      throw err;
    }
  }

  async requestDeliverate(user: AuthUser, shopId: string, orderId: string) {
    this.assertShopAccess(user, shopId);
    const row = await this.integrations.findOne({
      where: { shopId, provider: 'deliverate' },
    });
    if (!row?.enabled || !row.integrationId) {
      throw new BadRequestException(
        'Deliverate no está habilitado o falta el usuario shop (integration_id)',
      );
    }
    if (!row.apiToken && !row.shopPassword) {
      throw new BadRequestException(
        'Conectá Deliverate o cargá la password del shop para poder solicitar envíos',
      );
    }

    const order = await this.orders.findOne({ where: { id: orderId, shopId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.fulfillment !== CustomerOrderFulfillment.DELIVERY) {
      throw new BadRequestException('Solo pedidos delivery pueden solicitar Deliverate');
    }
    if (order.status === CustomerOrderStatus.CANCELLED) {
      throw new BadRequestException('El pedido está cancelado');
    }
    if (order.externalSource === 'deliverate' && order.externalId) {
      throw new BadRequestException('Este pedido ya tiene un envío Deliverate');
    }

    const lat = Number(order.deliveryLat);
    const lng = Number(order.deliveryLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException(
        'El pedido no tiene coordenadas de entrega. Pedí de nuevo con el mapa o cargá lat/lng.',
      );
    }
    const streetNumber =
      String(order.deliveryStreetNumber ?? '').trim() ||
      this.extractStreetNumber(order.address) ||
      'S/N';
    const total = Number(order.total);
    if (!Number.isFinite(total) || total <= 0) {
      throw new BadRequestException('El total del pedido debe ser mayor a 0');
    }

    const cashPrice = this.resolveCashPrice(order);
    const orderPayload = {
      integration_id: String(row.integrationId).trim(),
      integration_order_number: order.code,
      cash_price: cashPrice,
      price: total,
      street_number: streetNumber.slice(0, 40),
      is_exclusive_order: false,
      location: { coordinates: [lat, lng] as [number, number], type: 'Point' as const },
      notes: order.customerNotes || order.address || undefined,
      telephone: order.phone,
      is_test_order: !!row.testMode,
    };

    const tokens = await this.tokensForOrders(row);
    let created: DeliverateOrder | null = null;
    let lastErr: Error | null = null;
    for (const token of tokens) {
      try {
        created = await this.deliverate.createOrder(token, orderPayload);
        break;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        const msg = lastErr.message;
        this.logger.warn(`createOrder falló con un token: ${msg}`);
        if (!/can'?t create an order/i.test(msg) && !/401/i.test(msg) && tokens.length === 1) {
          break;
        }
      }
    }
    if (!created) {
      const msg = lastErr?.message ?? 'Error en Deliverate';
      const shopPass = String(row.shopPassword ?? '').trim();
      if (/can'?t create an order/i.test(msg)) {
        throw new BadRequestException(
          `Deliverate no permite crear el envío con el token de integración` +
            (shopPass
              ? `; también falló con la password del shop "${row.integrationId}".`
              : ` y falta la password del shop "${row.integrationId}".`) +
            ` Revisá el token (Conectar), cargá la password del shop y reintentá.`,
        );
      }
      throw lastErr ?? new BadRequestException(msg);
    }

    const orderIdRemote = String(created.order_id ?? '').trim();
    if (!orderIdRemote) {
      throw new BadRequestException('Deliverate no devolvió order_id');
    }

    // No marcamos kitchen_ready acá: Deliverate exige esperar delay_start_time.
    // Se marca cuando el pedido local pasa a READY (ver markDeliverateKitchenReady).
    order.externalSource = 'deliverate';
    order.externalId = orderIdRemote;
    order.externalMeta = this.buildMeta(created, {
      requestedAt: new Date().toISOString(),
      cashPrice,
      distance_price: created.distance_price,
      kitchenReadyPending: true,
    });
    await this.orders.save(order);
    row.lastError = null;
    await this.integrations.save(row);
    this.live.tick(shopId, 'customer-orders');

    if (
      order.status === CustomerOrderStatus.READY ||
      order.status === CustomerOrderStatus.OUT_FOR_DELIVERY
    ) {
      await this.markDeliverateKitchenReady(order).catch(() => undefined);
    }

    return this.orderDeliverateDto(order);
  }

  /**
   * Avisa a Deliverate que la cocina está lista (asignar repartidor).
   * Puede fallar si aún no cumplió delay_start_time de Deliverate.
   */
  async markDeliverateKitchenReady(order: CustomerOrder): Promise<void> {
    if (order.externalSource !== 'deliverate' || !order.externalId) return;
    const meta = (order.externalMeta ?? {}) as Record<string, unknown>;
    if (meta['is_kitchen_ready'] === true) return;

    const row = await this.integrations.findOne({
      where: { shopId: order.shopId, provider: 'deliverate' },
    });
    if (!row) return;

    const tokens = await this.tokensForOrders(row);
    let updated: DeliverateOrder | null = null;
    let lastErr: Error | null = null;
    for (const token of tokens) {
      try {
        updated = await this.deliverate.updateOrderState(token, {
          order_id: order.externalId,
          is_kitchen_ready: true,
        });
        break;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `kitchen_ready Deliverate ${order.externalId} falló: ${lastErr.message}`,
        );
      }
    }

    if (!updated) {
      order.externalMeta = {
        ...meta,
        kitchenReadyPending: true,
        kitchenReadyLastError: (lastErr?.message ?? 'Error').slice(0, 300),
      };
      await this.orders.save(order);
      return;
    }

    order.externalMeta = this.buildMeta(updated, {
      ...meta,
      kitchenReadyPending: false,
      kitchenReadyAt: new Date().toISOString(),
      kitchenReadyLastError: null,
    });
    await this.orders.save(order);
    this.live.tick(order.shopId, 'customer-orders');
  }

  async cancelDeliverateForOrder(order: CustomerOrder): Promise<void> {
    if (order.externalSource !== 'deliverate' || !order.externalId) return;
    const meta = (order.externalMeta ?? {}) as Record<string, unknown>;
    const state = Number(meta.state ?? 0);
    if (Number.isFinite(state) && state >= 1) {
      this.logger.log(
        `Skip cancel Deliverate ${order.externalId}: state=${state} (ya asignado)`,
      );
      return;
    }
    const row = await this.integrations.findOne({
      where: { shopId: order.shopId, provider: 'deliverate' },
    });
    if (!row?.apiToken && !row?.shopPassword) return;
    try {
      const tokens = await this.tokensForOrders(row);
      let updated: DeliverateOrder | null = null;
      for (const token of tokens) {
        try {
          updated = await this.deliverate.updateOrderState(token, {
            order_id: order.externalId,
            state: 6,
          });
          break;
        } catch (err) {
          this.logger.warn(`Cancel Deliverate con un token falló: ${String(err)}`);
        }
      }
      if (!updated) return;
      order.externalMeta = this.buildMeta(updated, {
        ...meta,
        cancelledLocallyAt: new Date().toISOString(),
      });
      await this.orders.save(order);
    } catch (err) {
      this.logger.warn(`Cancel Deliverate falló: ${String(err)}`);
    }
  }

  async getDboyLocation(user: AuthUser, shopId: string, orderId: string) {
    this.assertShopAccess(user, shopId);
    const order = await this.orders.findOne({ where: { id: orderId, shopId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    const dboyId = Number((order.externalMeta as any)?.dboy_id);
    if (!Number.isFinite(dboyId)) {
      throw new BadRequestException('El pedido aún no tiene repartidor asignado');
    }
    const row = await this.integrations.findOne({
      where: { shopId, provider: 'deliverate' },
    });
    if (!row?.apiToken) {
      throw new BadRequestException('Deliverate no está conectado');
    }
    return this.deliverate.getDboyLocation(row.apiToken, dboyId);
  }

  async handleWebhook(body: { action?: string; update?: Record<string, unknown> }) {
    const action = String(body?.action ?? '').trim();
    const update = body?.update ?? {};
    if (!action) {
      this.logger.warn('Deliverate webhook sin action');
      return { ok: true, ignored: true };
    }

    if (action === 'order_update') {
      await this.applyOrderUpdate(update);
      return { ok: true };
    }
    if (action === 'order_create') {
      await this.applyOrderCreate(update);
      return { ok: true };
    }
    this.logger.log(`Deliverate webhook ignorado: ${action}`);
    return { ok: true, ignored: true };
  }

  private async applyOrderUpdate(update: Record<string, unknown>) {
    const remoteId = String(update.order_id ?? '').trim();
    const integrationId = String(update.integration_id ?? '').trim();
    const integrationOrderNumber = String(
      update.integration_order_number ?? '',
    ).trim();

    let order: CustomerOrder | null = null;
    if (remoteId) {
      order = await this.orders.findOne({
        where: { externalSource: 'deliverate', externalId: remoteId },
      });
    }
    if (!order && integrationId && integrationOrderNumber) {
      const integ = await this.integrations.findOne({
        where: { provider: 'deliverate', integrationId },
      });
      if (integ) {
        order = await this.orders.findOne({
          where: { shopId: integ.shopId, code: integrationOrderNumber },
        });
      }
    }
    if (!order && remoteId) {
      // Fallback: a veces externalSource aún no está, pero el id ya se guardó.
      order = await this.orders.findOne({ where: { externalId: remoteId } });
    }
    if (!order) {
      this.logger.warn(
        `Webhook order_update sin pedido local order_id=${remoteId} integration_id=${integrationId} code=${integrationOrderNumber}`,
      );
      return;
    }

    const prevMeta = (order.externalMeta ?? {}) as Record<string, unknown>;
    const prevStatus = order.status;
    order.externalSource = 'deliverate';
    if (remoteId) order.externalId = remoteId;
    order.externalMeta = {
      ...prevMeta,
      ...this.pickMeta(update),
      lastWebhookAt: new Date().toISOString(),
    };

    const state = Number(update.state);
    const now = new Date();
    if (state === 1) {
      if (
        order.status !== CustomerOrderStatus.OUT_FOR_DELIVERY &&
        order.status !== CustomerOrderStatus.COMPLETED &&
        order.status !== CustomerOrderStatus.CANCELLED
      ) {
        if (
          order.status === CustomerOrderStatus.PENDING ||
          order.status === CustomerOrderStatus.ACCEPTED ||
          order.status === CustomerOrderStatus.PREPARING
        ) {
          order.status = CustomerOrderStatus.READY;
          order.readyAt = order.readyAt ?? now;
        }
      }
    } else if (state === 2) {
      if (order.status !== CustomerOrderStatus.COMPLETED && order.status !== CustomerOrderStatus.CANCELLED) {
        order.status = CustomerOrderStatus.OUT_FOR_DELIVERY;
        order.outForDeliveryAt = order.outForDeliveryAt ?? now;
        order.readyAt = order.readyAt ?? now;
      }
    } else if (state === 3) {
      if (order.status !== CustomerOrderStatus.CANCELLED) {
        order.status = CustomerOrderStatus.COMPLETED;
        order.completedAt = now;
        order.outForDeliveryAt = order.outForDeliveryAt ?? now;
        if (!order.paymentAccreditedAt) {
          order.paymentAccreditedAt = now;
        }
      }
    } else if (state === 4 || state === 5 || state === 6) {
      // Cancelación en Deliverate: no cancela el pedido local; libera el vínculo
      // para poder volver a «Solicitar Deliverate».
      if (order.status !== CustomerOrderStatus.COMPLETED && order.status !== CustomerOrderStatus.CANCELLED) {
        if (order.status === CustomerOrderStatus.OUT_FOR_DELIVERY) {
          order.status = CustomerOrderStatus.READY;
          order.outForDeliveryAt = null;
          order.readyAt = order.readyAt ?? now;
        }
        order.externalSource = null;
        order.externalId = null;
        order.externalMeta = {
          lastDeliverateCancelAt: now.toISOString(),
          lastDeliverateCancelState: state,
          lastDeliverateOrderId: remoteId || null,
        };
      }
    } else if (!Number.isFinite(state)) {
      this.logger.warn(
        `Webhook order_update sin state numérico order_id=${remoteId} state=${String(update.state)}`,
      );
    }

    await this.orders.save(order);
    this.logger.log(
      `Webhook order_update aplicado code=${order.code} state=${state} ${prevStatus}→${order.status}` +
        (state >= 4 && state <= 6 && !order.externalId ? ' (Deliverate desvinculado)' : ''),
    );
    this.live.tick(order.shopId, 'customer-orders');
  }

  private async applyOrderCreate(update: Record<string, unknown>) {
    const integrationId = String(update.integration_id ?? '').trim();
    const remoteId = String(update.order_id ?? '').trim();
    if (!integrationId || !remoteId) return;

    const existing = await this.orders.findOne({
      where: { externalSource: 'deliverate', externalId: remoteId },
    });
    if (existing) {
      await this.applyOrderUpdate(update);
      return;
    }

    const integ = await this.integrations.findOne({
      where: { provider: 'deliverate', integrationId },
    });
    if (!integ) {
      this.logger.warn(`order_create sin shop para integration_id=${integrationId}`);
      return;
    }

    const code =
      String(update.integration_order_number ?? '').trim().slice(0, 12) ||
      `D${Date.now().toString(36).slice(-5).toUpperCase()}`;
    const coords = (update.location as any)?.coordinates;
    const lat = Array.isArray(coords) ? Number(coords[0]) : null;
    const lng = Array.isArray(coords) ? Number(coords[1]) : null;
    const priceArr = (update.real_price as any)?.price_value;
    const total = Array.isArray(priceArr) ? Number(priceArr[0]) : Number(update.price) || 0;

    const order = await this.orders.save(
      this.orders.create({
        shopId: integ.shopId,
        code,
        status: CustomerOrderStatus.PENDING,
        fulfillment: CustomerOrderFulfillment.DELIVERY,
        items: [
          {
            menuItemId: 'deliverate',
            name: 'Pedido Deliverate',
            unitPrice: total,
            qty: 1,
            notes: String(update.notes ?? '') || null,
          },
        ],
        subtotal: total.toFixed(2),
        deliveryFee: '0.00',
        discountAmount: '0.00',
        total: Math.max(0.01, total).toFixed(2),
        firstName: 'Deliverate',
        lastName: String(update.shop_name ?? integrationId).slice(0, 80),
        phone: String(update.telephone ?? '').replace(/\D/g, '').slice(0, 40) || '000000',
        address: null,
        deliveryLat: lat != null && Number.isFinite(lat) ? lat.toFixed(7) : null,
        deliveryLng: lng != null && Number.isFinite(lng) ? lng.toFixed(7) : null,
        deliveryStreetNumber: String(update.street_number ?? '').slice(0, 40) || null,
        paymentMethod: CustomerOrderPaymentMethod.CASH,
        customerNotes: String(update.notes ?? '') || null,
        externalSource: 'deliverate',
        externalId: remoteId,
        externalMeta: {
          ...this.pickMeta(update),
          inbound: true,
          lastWebhookAt: new Date().toISOString(),
        },
      }),
    );
    this.live.tick(integ.shopId, 'customer-orders');
    this.logger.log(`Pedido inbound Deliverate ${order.code} shop=${integ.shopId}`);
  }

  private resolveCashPrice(order: CustomerOrder): number {
    if (order.paymentMethod === CustomerOrderPaymentMethod.TRANSFER) return 0;
    if (order.paymentAccreditedAt) return 0;
    const total = Number(order.total);
    return Number.isFinite(total) && total > 0 ? total : 0;
  }

  private extractStreetNumber(address?: string | null): string | null {
    const raw = String(address ?? '');
    const m = raw.match(/\b(\d{1,6}[A-Za-z]?)\b/);
    return m?.[1] ?? null;
  }

  private pickMeta(update: Record<string, unknown>): Record<string, unknown> {
    const keys = [
      'state',
      'dboy_id',
      'delay_start_time',
      'delay_end_time',
      'withdrawn_delay',
      'confirmed_delay',
      'is_kitchen_ready',
      'is_payed_online',
      'is_exclusive_order',
      'is_return_order',
      'is_getting_help',
      'is_high_demand',
      'distance',
      'distance_price',
      'order_number',
    ];
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (update[k] !== undefined) out[k] = update[k];
    }
    return out;
  }

  private buildMeta(
    order: DeliverateOrder,
    extra?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...this.pickMeta(order as unknown as Record<string, unknown>),
      ...(extra ?? {}),
    };
  }

  orderDeliverateDto(order: CustomerOrder) {
    return {
      id: order.id,
      code: order.code,
      status: order.status,
      externalSource: order.externalSource ?? null,
      externalId: order.externalId ?? null,
      externalMeta: order.externalMeta ?? null,
      deliveryLat: order.deliveryLat == null ? null : Number(order.deliveryLat),
      deliveryLng: order.deliveryLng == null ? null : Number(order.deliveryLng),
      deliveryStreetNumber: order.deliveryStreetNumber ?? null,
    };
  }
}
