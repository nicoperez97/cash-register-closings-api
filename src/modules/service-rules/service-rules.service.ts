import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceRuleCategory } from '../../entities/service-rule-category.entity';
import { ServiceRule } from '../../entities/service-rule.entity';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import { ServiceRulePhase } from '../../common/enums';
import { GeminiDocumentService } from '../ai/gemini-document.service';
import { ShopsService } from '../shops/shops.service';
import { buildServiceRulesPdf } from './service-rules-pdf';

export type ServiceRulesImportDraft = {
  categories: Array<{
    name: string;
    rules: Array<{ phase: ServiceRulePhase; title: string; body: string }>;
  }>;
};

@Injectable()
export class ServiceRulesService implements OnModuleInit {
  private readonly logger = new Logger(ServiceRulesService.name);

  constructor(
    @InjectRepository(ServiceRuleCategory)
    private readonly categories: Repository<ServiceRuleCategory>,
    @InjectRepository(ServiceRule)
    private readonly rules: Repository<ServiceRule>,
    private readonly shops: ShopsService,
    private readonly gemini: GeminiDocumentService,
  ) {}

  async onModuleInit() {
    try {
      await this.categories.query(`
        CREATE TABLE IF NOT EXISTS service_rule_categories (
          id CHAR(36) NOT NULL PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          name VARCHAR(120) NOT NULL,
          sortOrder INT NOT NULL DEFAULT 0,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX idx_src_shop (shopId)
        )
      `);
      await this.rules.query(`
        CREATE TABLE IF NOT EXISTS service_rules (
          id CHAR(36) NOT NULL PRIMARY KEY,
          shopId CHAR(36) NOT NULL,
          categoryId CHAR(36) NOT NULL,
          phase ENUM('PRE', 'DURING', 'POST') NOT NULL DEFAULT 'PRE',
          title VARCHAR(200) NOT NULL,
          body TEXT NOT NULL,
          sortOrder INT NOT NULL DEFAULT 0,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL,
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          INDEX idx_sr_shop (shopId),
          INDEX idx_sr_cat (categoryId)
        )
      `);
      try {
        await this.rules.query(`
          ALTER TABLE service_rules
          MODIFY COLUMN phase ENUM('PRE', 'DURING', 'POST') NOT NULL DEFAULT 'PRE'
        `);
      } catch (alterErr) {
        this.logger.warn(
          `No se pudo ampliar phase de normas: ${(alterErr as Error)?.message ?? alterErr}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `No se pudieron asegurar tablas de normas: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  private categoryDto(row: ServiceRuleCategory) {
    return {
      id: row.id,
      shopId: row.shopId,
      name: row.name,
      sortOrder: row.sortOrder ?? 0,
      active: isEntityActive(row.active),
    };
  }

  private ruleDto(row: ServiceRule) {
    return {
      id: row.id,
      shopId: row.shopId,
      categoryId: row.categoryId,
      phase: row.phase,
      title: row.title,
      body: row.body,
      sortOrder: row.sortOrder ?? 0,
      active: isEntityActive(row.active),
    };
  }

  async list(user: AuthUser, shopId: string, includeInactive = false) {
    this.shops.assertShopAccess(user, shopId);
    const [cats, rules] = await Promise.all([
      this.categories.find({
        where: { shopId },
        order: { sortOrder: 'ASC', name: 'ASC' },
      }),
      this.rules.find({
        where: { shopId },
        order: { sortOrder: 'ASC', title: 'ASC' },
      }),
    ]);
    const categories = includeInactive
      ? cats
      : cats.filter((c) => isEntityActive(c.active));
    const catIds = new Set(categories.map((c) => c.id));
    const filteredRules = (includeInactive ? rules : rules.filter((r) => isEntityActive(r.active)))
      .filter((r) => catIds.has(r.categoryId));
    return {
      categories: categories.map((c) => this.categoryDto(c)),
      rules: filteredRules.map((r) => this.ruleDto(r)),
    };
  }

  async createCategory(user: AuthUser, shopId: string, dto: { name: string; sortOrder?: number }) {
    this.shops.assertShopAccess(user, shopId);
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Indicá el nombre de la categoría');
    const sortOrder =
      dto.sortOrder ??
      (await this.nextCategoryOrder(shopId));
    const row = await this.categories.save(
      this.categories.create({ shopId, name, sortOrder, active: true }),
    );
    return this.categoryDto(row);
  }

  async updateCategory(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: { name?: string; sortOrder?: number; active?: boolean },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.categories.findOne({ where: { id, shopId } });
    if (!row || row.deletedAt) throw new NotFoundException('Categoría no encontrada');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Indicá el nombre de la categoría');
      row.name = name;
    }
    if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) row.active = dto.active;
    return this.categoryDto(await this.categories.save(row));
  }

  async removeCategory(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.categories.findOne({ where: { id, shopId } });
    if (!row || row.deletedAt) throw new NotFoundException('Categoría no encontrada');
    const now = new Date();
    row.deletedAt = now;
    row.active = false;
    await this.categories.save(row);
    const related = await this.rules.find({ where: { shopId, categoryId: id } });
    for (const r of related) {
      if (r.deletedAt) continue;
      r.deletedAt = now;
      r.active = false;
    }
    if (related.length) await this.rules.save(related);
    return { ok: true };
  }

  async createRule(
    user: AuthUser,
    shopId: string,
    dto: {
      categoryId: string;
      phase: ServiceRulePhase;
      title: string;
      body: string;
      sortOrder?: number;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const category = await this.requireCategory(shopId, dto.categoryId);
    const title = (dto.title ?? '').trim();
    const body = (dto.body ?? '').trim();
    if (!title) throw new BadRequestException('Indicá el título');
    if (!body) throw new BadRequestException('Indicá el texto de la norma');
    this.assertPhase(dto.phase);
    const sortOrder =
      dto.sortOrder ?? (await this.nextRuleOrder(shopId, category.id, dto.phase));
    const row = await this.rules.save(
      this.rules.create({
        shopId,
        categoryId: category.id,
        phase: dto.phase,
        title,
        body,
        sortOrder,
        active: true,
      }),
    );
    return this.ruleDto(row);
  }

  async updateRule(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: {
      categoryId?: string;
      phase?: ServiceRulePhase;
      title?: string;
      body?: string;
      sortOrder?: number;
      active?: boolean;
    },
  ) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.rules.findOne({ where: { id, shopId } });
    if (!row || row.deletedAt) throw new NotFoundException('Norma no encontrada');
    if (dto.categoryId !== undefined) {
      const category = await this.requireCategory(shopId, dto.categoryId);
      row.categoryId = category.id;
    }
    if (dto.phase !== undefined) {
      this.assertPhase(dto.phase);
      row.phase = dto.phase;
    }
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('Indicá el título');
      row.title = title;
    }
    if (dto.body !== undefined) {
      const body = dto.body.trim();
      if (!body) throw new BadRequestException('Indicá el texto de la norma');
      row.body = body;
    }
    if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) row.active = dto.active;
    return this.ruleDto(await this.rules.save(row));
  }

  async removeRule(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.rules.findOne({ where: { id, shopId } });
    if (!row || row.deletedAt) throw new NotFoundException('Norma no encontrada');
    row.deletedAt = new Date();
    row.active = false;
    await this.rules.save(row);
    return { ok: true };
  }

  async publicBySlug(slug: string) {
    const shop = await this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase());
    if (!shop || !shop.publicServiceRulesEnabled) {
      throw new NotFoundException('Normas no disponibles en este local');
    }
    const [cats, rules] = await Promise.all([
      this.categories.find({
        where: { shopId: shop.id },
        order: { sortOrder: 'ASC', name: 'ASC' },
      }),
      this.rules.find({
        where: { shopId: shop.id },
        order: { sortOrder: 'ASC', title: 'ASC' },
      }),
    ]);
    const categories = cats.filter((c) => isEntityActive(c.active));
    const catIds = new Set(categories.map((c) => c.id));
    const activeRules = rules.filter(
      (r) => isEntityActive(r.active) && catIds.has(r.categoryId),
    );
    return {
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
      },
      categories: categories.map((c) => this.categoryDto(c)),
      rules: activeRules.map((r) => this.ruleDto(r)),
    };
  }

  async publicPdf(slug: string) {
    const data = await this.publicBySlug(slug);
    const bytes = await buildServiceRulesPdf({
      shopName: data.shop.name,
      accentColor: data.shop.accentColor,
      categories: data.categories,
      rules: data.rules,
    });
    const safe = String(data.shop.slug || 'local').replace(/[^a-z0-9-]+/gi, '-');
    return {
      buffer: Buffer.from(bytes),
      filename: `normas-${safe}.pdf`,
    };
  }

  async parseUpload(user: AuthUser, shopId: string, file?: Express.Multer.File) {
    this.shops.assertShopAccess(user, shopId);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Subí un PDF, una imagen o un .txt con las normas');
    }
    if (!this.gemini.isEnabled()) {
      throw new BadRequestException('Gemini no está configurado (falta GEMINI_API_KEY).');
    }
    const ai = await this.gemini.parseServiceRules(file);
    if (!ai.ok) {
      throw new BadRequestException(ai.message || 'No se pudieron interpretar las normas');
    }
    return {
      categories: ai.data.categories,
      fileName: file.originalname || null,
    };
  }

  async importDraft(user: AuthUser, shopId: string, draft: ServiceRulesImportDraft) {
    this.shops.assertShopAccess(user, shopId);
    const normalized = this.normalizeImportDraft(draft);
    if (!normalized.categories.length) {
      throw new BadRequestException('No hay normas para importar');
    }

    const existing = await this.categories.find({ where: { shopId } });
    const byName = new Map<string, ServiceRuleCategory>();
    for (const row of existing) {
      if (row.deletedAt || !isEntityActive(row.active)) continue;
      byName.set(row.name.trim().toLowerCase(), row);
    }

    let catOrder = await this.nextCategoryOrder(shopId);
    const ruleOrderCache = new Map<string, number>();

    for (const cat of normalized.categories) {
      const key = cat.name.toLowerCase();
      let category = byName.get(key);
      if (!category) {
        category = await this.categories.save(
          this.categories.create({
            shopId,
            name: cat.name,
            sortOrder: catOrder++,
            active: true,
          }),
        );
        byName.set(key, category);
      }

      for (const rule of cat.rules) {
        const cacheKey = `${category.id}:${rule.phase}`;
        let next =
          ruleOrderCache.get(cacheKey) ??
          (await this.nextRuleOrder(shopId, category.id, rule.phase));
        await this.rules.save(
          this.rules.create({
            shopId,
            categoryId: category.id,
            phase: rule.phase,
            title: rule.title,
            body: rule.body,
            sortOrder: next,
            active: true,
          }),
        );
        ruleOrderCache.set(cacheKey, next + 1);
      }
    }

    return this.list(user, shopId);
  }

  private normalizeImportDraft(draft: ServiceRulesImportDraft): ServiceRulesImportDraft {
    const categories = (draft?.categories ?? [])
      .map((c) => {
        const name = String(c?.name ?? '')
          .trim()
          .slice(0, 120);
        const rules = (c?.rules ?? [])
          .map((r) => {
            const title = String(r?.title ?? '')
              .trim()
              .slice(0, 200);
            const body =
              String(r?.body ?? '')
                .trim()
                .slice(0, 8000) || title;
            const phase = this.parsePhase(r?.phase);
            return { phase, title, body };
          })
          .filter((r) => r.title && r.body);
        return { name, rules };
      })
      .filter((c) => c.name && c.rules.length);
    return { categories };
  }

  private async requireCategory(shopId: string, categoryId: string) {
    const row = await this.categories.findOne({ where: { id: categoryId, shopId } });
    if (!row || row.deletedAt) throw new BadRequestException('Categoría inválida');
    return row;
  }

  private parsePhase(raw: unknown): ServiceRulePhase {
    const t = String(raw ?? '')
      .trim()
      .toUpperCase();
    if (
      t === ServiceRulePhase.POST ||
      t.includes('DESPU') ||
      t.includes('CIERRE') ||
      t.includes('AFTER')
    ) {
      return ServiceRulePhase.POST;
    }
    if (
      t === ServiceRulePhase.DURING ||
      t.includes('DURANT') ||
      t.includes('DURING') ||
      t.includes('EN SERVICIO') ||
      t.includes('MID')
    ) {
      return ServiceRulePhase.DURING;
    }
    return ServiceRulePhase.PRE;
  }

  private assertPhase(phase: ServiceRulePhase) {
    if (
      phase !== ServiceRulePhase.PRE &&
      phase !== ServiceRulePhase.DURING &&
      phase !== ServiceRulePhase.POST
    ) {
      throw new BadRequestException('Fase inválida');
    }
  }

  private async nextCategoryOrder(shopId: string) {
    const rows = await this.categories.find({
      where: { shopId },
      select: ['sortOrder'],
    });
    return rows.reduce((max, r) => Math.max(max, r.sortOrder ?? 0), -1) + 1;
  }

  private async nextRuleOrder(shopId: string, categoryId: string, phase: ServiceRulePhase) {
    const rows = await this.rules.find({
      where: { shopId, categoryId, phase },
      select: ['sortOrder'],
    });
    return rows.reduce((max, r) => Math.max(max, r.sortOrder ?? 0), -1) + 1;
  }
}
