import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shop } from '../../entities/shop.entity';
import { AuthUser } from '../../common/decorators';
import { ShopsService } from '../shops/shops.service';
import {
  emptyShopMenu,
  menuHasItems,
  normalizeShopMenus,
  parseMenuFile,
  ShopMenu,
} from './menu-parse.util';

@Injectable()
export class MenuService {
  constructor(
    @InjectRepository(Shop) private readonly shopsRepo: Repository<Shop>,
    private readonly shops: ShopsService,
  ) {}

  private readMenus(shop: Shop): ShopMenu[] {
    return normalizeShopMenus(shop.menu);
  }

  async getAdmin(user: AuthUser, shopId: string) {
    this.shops.assertShopManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    return {
      enabled: !!shop.menuEnabled,
      slug: shop.slug,
      menus: this.readMenus(shop),
    };
  }

  async saveAdmin(user: AuthUser, shopId: string, body: { menus?: ShopMenu[] } | ShopMenu) {
    this.shops.assertShopManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    const menus = normalizeShopMenus(
      body && typeof body === 'object' && Array.isArray((body as { menus?: ShopMenu[] }).menus)
        ? body
        : { menus: [body as ShopMenu] },
    );
    shop.menu = { menus };
    await this.shopsRepo.save(shop);
    return { enabled: !!shop.menuEnabled, slug: shop.slug, menus: this.readMenus(shop) };
  }

  async parseUpload(user: AuthUser, shopId: string, file?: Express.Multer.File) {
    this.shops.assertShopManage(user, shopId);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Subí un PDF, una imagen o un .txt de la carta');
    }
    try {
      const parsed = await parseMenuFile(file);
      const menu = emptyShopMenu(parsed.menu);
      return {
        menu,
        rawText: parsed.rawText,
        fileName: file.originalname,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo leer el archivo';
      throw new BadRequestException(msg);
    }
  }

  private publicShop(shop: Shop) {
    return {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      logoUrl: shop.logoUrl ?? null,
      accentColor: shop.accentColor ?? null,
      phone: shop.phone ?? null,
      instagramHandle: shop.instagramHandle ?? null,
    };
  }

  async publicMenu(slug: string, menuSlug?: string) {
    const shop = await this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase());
    if (!shop || !shop.menuEnabled) {
      throw new NotFoundException('Carta no disponible en este local');
    }
    const published = this.readMenus(shop).filter(menuHasItems);
    if (!published.length) {
      throw new NotFoundException('Carta no disponible en este local');
    }
    const wanted = String(menuSlug ?? '').trim().toLowerCase();
    const selected = wanted
      ? published.find((m) => m.slug === wanted)
      : published[0];
    if (!selected) throw new NotFoundException('Carta no disponible en este local');
    return {
      shop: this.publicShop(shop),
      menus: published.map((m) => ({
        slug: m.slug,
        title: m.title || 'Carta',
      })),
      menu: selected,
    };
  }
}
