import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import AdmZip from 'adm-zip';
import { CashClosing } from '../../entities/cash-closing.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import { ExpenseCategory, GlobalRole } from '../../common/enums';
import { ShopsService } from '../shops/shops.service';
import { ClosingsService } from './closings.service';
import {
  extractClosingDrafts,
  parseWhatsAppChat,
  ParsedClosingDraft,
} from './whatsapp-chat.parser';

const IMPORT_PASSWORD = '123456';

export interface WhatsappImportItem {
  businessDate: string;
  cardAmount: number;
  cashAmount: number;
  posSystemAmount: number;
  cashLeftInRegister: number;
  cashWithdrawn: number;
  cashWithdrawnByName: string | null;
  cashWithdrawnByUserId: string | null;
  unitsSold: number | null;
  declaredTotal: number;
  notes: string | null;
  expenses: Array<{ label: string; amount: number; category?: ExpenseCategory }>;
  confidence: 'high' | 'medium' | 'low';
  sourceAuthors: string[];
  rawSnippets: string[];
  alreadyExists: boolean;
  selected: boolean;
  /** En preview: el retiro no matchea usuario y se creará al confirmar. */
  willCreateUser?: boolean;
}

@Injectable()
export class WhatsappImportService {
  constructor(
    @InjectRepository(CashClosing) private readonly closings: Repository<CashClosing>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserShop) private readonly userShops: Repository<UserShop>,
    private readonly shops: ShopsService,
    private readonly closingsService: ClosingsService,
  ) {}

  async preview(user: AuthUser, shopId: string, file: Express.Multer.File) {
    this.shops.assertShopAccess(user, shopId);
    const drafts = this.parseZip(file);
    return this.enrich(shopId, drafts, false);
  }

  async commit(user: AuthUser, shopId: string, file: Express.Multer.File) {
    this.shops.assertShopAccess(user, shopId);
    const drafts = this.parseZip(file);
    const items = await this.enrich(shopId, drafts, true);
    const toCreate = items.filter((i) => !i.alreadyExists && (i.cardAmount > 0 || i.cashAmount > 0));

    const created: string[] = [];
    const createdUsers: string[] = [];
    const skipped: Array<{ businessDate: string; reason: string }> = [];

    for (const item of items) {
      if (item.alreadyExists) {
        skipped.push({ businessDate: item.businessDate, reason: 'Ya existe un cierre para esa fecha' });
        continue;
      }
      if (!(item.cardAmount > 0 || item.cashAmount > 0)) {
        skipped.push({ businessDate: item.businessDate, reason: 'Sin montos suficientes' });
        continue;
      }
      try {
        if (item.willCreateUser && item.cashWithdrawnByName) {
          createdUsers.push(item.cashWithdrawnByName);
        }
        const row = await this.closingsService.create(user, shopId, {
          businessDate: item.businessDate,
          cardAmount: item.cardAmount,
          cashAmount: item.cashAmount,
          posSystemAmount: item.posSystemAmount,
          cashLeftInRegister: item.cashLeftInRegister,
          cashWithdrawn: item.cashWithdrawn,
          cashWithdrawnByName: item.cashWithdrawnByName ?? undefined,
          cashWithdrawnByUserId: item.cashWithdrawnByUserId ?? undefined,
          unitsSold: item.unitsSold ?? undefined,
          declaredTotal: item.declaredTotal || undefined,
          notes: item.notes
            ? `${item.notes}\n[Importado desde WhatsApp]`
            : '[Importado desde WhatsApp]',
          expenses: item.expenses.map((e) => ({
            label: e.label,
            amount: e.amount,
            category: e.category ?? ExpenseCategory.OTHER,
          })),
        });
        created.push(row.id);
      } catch (err: any) {
        skipped.push({
          businessDate: item.businessDate,
          reason: err?.message ?? 'Error al crear',
        });
      }
    }

    return {
      createdCount: created.length,
      skippedCount: skipped.length,
      createdIds: created,
      createdUsers: [...new Set(createdUsers)],
      skipped,
      preview: items,
      considered: toCreate.length,
    };
  }

  private parseZip(file: Express.Multer.File): ParsedClosingDraft[] {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Adjuntá un archivo ZIP de WhatsApp');
    }
    const name = (file.originalname || '').toLowerCase();
    if (!name.endsWith('.zip') && file.mimetype !== 'application/zip' && file.mimetype !== 'application/x-zip-compressed') {
      throw new BadRequestException('El archivo debe ser un ZIP exportado de WhatsApp');
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(file.buffer);
    } catch {
      throw new BadRequestException('No se pudo leer el ZIP');
    }

    const entry =
      zip.getEntries().find((e) => !e.isDirectory && /_chat\.txt$/i.test(e.entryName)) ||
      zip.getEntries().find((e) => !e.isDirectory && /\.txt$/i.test(e.entryName));

    if (!entry) {
      throw new BadRequestException('El ZIP no contiene _chat.txt (export de WhatsApp)');
    }

    const text = entry.getData().toString('utf8');
    const messages = parseWhatsAppChat(text);
    if (!messages.length) {
      throw new BadRequestException('No se encontraron mensajes en el chat');
    }
    const drafts = extractClosingDrafts(messages);
    if (!drafts.length) {
      throw new BadRequestException('No se detectaron cierres en la conversación');
    }
    return drafts;
  }

  private async enrich(
    shopId: string,
    drafts: ParsedClosingDraft[],
    createMissingUsers: boolean,
  ): Promise<WhatsappImportItem[]> {
    const dates = drafts.map((d) => d.businessDate);
    const existing = dates.length
      ? await this.closings.find({
          where: { shopId, businessDate: In(dates), active: true },
          select: ['businessDate'],
        })
      : [];
    const existingSet = new Set(existing.map((e) => e.businessDate));

    const allUsers = await this.users.find({ where: { active: true } });
    const links = await this.userShops.find({ where: { shopId } });
    const shopUserIds = new Set(links.map((l) => l.userId));

    const createdCache = new Map<string, User>();

    const items: WhatsappImportItem[] = [];
    for (const d of drafts) {
      const name = d.cashWithdrawnByName?.trim() || null;
      let matched = name ? this.matchUser(name, allUsers) : null;
      let willCreateUser = false;

      if (name && !matched) {
        willCreateUser = true;
        if (createMissingUsers) {
          const key = this.normalizeName(name);
          matched = createdCache.get(key) ?? (await this.createViewerUser(name, shopId));
          createdCache.set(key, matched);
          allUsers.push(matched);
          shopUserIds.add(matched.id);
        }
      } else if (matched && !shopUserIds.has(matched.id) && createMissingUsers) {
        await this.linkUserToShop(matched.id, shopId);
        shopUserIds.add(matched.id);
      }

      const declared =
        d.declaredTotal && d.declaredTotal > 0
          ? d.declaredTotal
          : d.cardAmount + d.cashAmount;

      items.push({
        businessDate: d.businessDate,
        cardAmount: d.cardAmount,
        cashAmount: d.cashAmount,
        posSystemAmount: d.posSystemAmount || declared,
        cashLeftInRegister: d.cashLeftInRegister,
        cashWithdrawn: d.cashWithdrawn,
        cashWithdrawnByName: matched?.fullName ?? name,
        cashWithdrawnByUserId: matched?.id ?? null,
        unitsSold: d.unitsSold,
        declaredTotal: declared,
        notes: d.notes,
        expenses: d.expenses,
        confidence: d.confidence,
        sourceAuthors: d.sourceAuthors,
        rawSnippets: d.rawSnippets,
        alreadyExists: existingSet.has(d.businessDate),
        selected: !existingSet.has(d.businessDate),
        willCreateUser,
      });
    }
    return items;
  }

  private async createViewerUser(fullName: string, shopId: string): Promise<User> {
    const passwordHash = await bcrypt.hash(IMPORT_PASSWORD, 10);
    const email = await this.uniqueImportEmail(fullName);
    const user = await this.users.save(
      this.users.create({
        fullName: fullName.trim(),
        email,
        passwordHash,
        globalRole: GlobalRole.VIEWER,
        active: true,
      }),
    );
    await this.linkUserToShop(user.id, shopId);
    return user;
  }

  private async linkUserToShop(userId: string, shopId: string): Promise<void> {
    const existing = await this.userShops.findOne({ where: { userId, shopId } });
    if (existing) return;
    await this.userShops.save(
      this.userShops.create({
        userId,
        shopId,
        shopRole: GlobalRole.VIEWER,
      }),
    );
  }

  private async uniqueImportEmail(fullName: string): Promise<string> {
    const base =
      this.normalizeName(fullName)
        .replace(/\s+/g, '.')
        .replace(/[^a-z0-9.]/g, '')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '') || 'usuario';
    let email = `${base}@import.cierres.local`;
    let i = 1;
    while (await this.users.findOne({ where: { email } })) {
      email = `${base}.${i}@import.cierres.local`;
      i += 1;
    }
    return email;
  }

  private matchUser(name: string | null, users: User[]): User | null {
    if (!name || !users.length) return null;
    const norm = this.normalizeName(name);
    if (!norm) return null;
    const exact = users.find((u) => this.normalizeName(u.fullName) === norm);
    if (exact) return exact;
    const first = norm.split(/\s+/)[0];
    const partial = users.find((u) => {
      const n = this.normalizeName(u.fullName);
      return n.includes(norm) || (first.length >= 3 && n.includes(first));
    });
    return partial ?? null;
  }

  private normalizeName(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
  }
}
