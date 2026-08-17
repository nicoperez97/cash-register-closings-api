import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shop } from '../../entities/shop.entity';
import { AuthUser } from '../../common/decorators';
import { ShopsService } from '../shops/shops.service';
import {
  normalizeShopMenu,
  parseMenuFile,
  ShopMenu,
} from './menu-parse.util';

@Injectable()
export class MenuService {
  constructor(
    @InjectRepository(Shop) private readonly shopsRepo: Repository<Shop>,
    private readonly shops: ShopsService,
  ) {}

  async getAdmin(user: AuthUser, shopId: string) {
    this.shops.assertShopManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    return {
      enabled: !!shop.menuEnabled,
      slug: shop.slug,
      menu: normalizeShopMenu(shop.menu as ShopMenu | null),
    };
  }

  async saveAdmin(user: AuthUser, shopId: string, menu: ShopMenu) {
    this.shops.assertShopManage(user, shopId);
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Local no encontrado');
    shop.menu = normalizeShopMenu(menu);
    await this.shopsRepo.save(shop);
    return { enabled: !!shop.menuEnabled, slug: shop.slug, menu: shop.menu };
  }

  async parseUpload(user: AuthUser, shopId: string, file?: Express.Multer.File) {
    this.shops.assertShopManage(user, shopId);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Subí un PDF, una imagen o un .txt de la carta');
    }
    try {
      const parsed = await parseMenuFile(file);
      return {
        menu: normalizeShopMenu(parsed.menu),
        rawText: parsed.rawText,
        fileName: file.originalname,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo leer el archivo';
      throw new BadRequestException(msg);
    }
  }

  async publicMenu(slug: string) {
    const shop = await this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase());
    if (!shop || !shop.menuEnabled) {
      throw new NotFoundException('Carta no disponible en este local');
    }
    const menu = normalizeShopMenu(shop.menu as ShopMenu | null);
    if (!menu.sections.some((s) => s.items.length)) {
      throw new NotFoundException('Carta no disponible en este local');
    }
    return {
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl ?? null,
        accentColor: shop.accentColor ?? null,
        phone: shop.phone ?? null,
        instagramHandle: shop.instagramHandle ?? null,
      },
      menu,
    };
  }
}
