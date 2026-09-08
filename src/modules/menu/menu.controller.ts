import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  AuthUser,
  CurrentUser,
  Public,
  RequireAnyPermissions,
} from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { MenuService } from './menu.service';
import { ShopMenu } from './menu-parse.util';

const menuUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const itemImageUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

@ApiTags('menu')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/menu')
export class MenuController {
  constructor(private readonly menus: MenuService) {}

  @Get()
  @RequireAnyPermissions('shops.manage', 'orderingCatalog.manage')
  get(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.menus.getAdmin(user, shopId);
  }

  @Put()
  @RequireAnyPermissions('shops.manage', 'orderingCatalog.manage')
  save(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() body: { menus?: ShopMenu[] } | ShopMenu,
  ) {
    return this.menus.saveAdmin(user, shopId, body);
  }

  @Post('parse')
  @RequireAnyPermissions('shops.manage', 'orderingCatalog.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(menuUpload)
  parse(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.menus.parseUpload(user, shopId, file);
  }

  @Post('items/:itemId/image')
  @RequireAnyPermissions('shops.manage', 'orderingCatalog.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(itemImageUpload)
  uploadItemImage(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('itemId') itemId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.menus.uploadItemImage(user, shopId, itemId, file);
  }

  @Delete('items/:itemId/image')
  @RequireAnyPermissions('shops.manage', 'orderingCatalog.manage')
  clearItemImage(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.menus.clearItemImage(user, shopId, itemId);
  }

  @Post(':menuId/source')
  @RequireAnyPermissions('shops.manage', 'orderingCatalog.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(menuUpload)
  attachSource(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('menuId') menuId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.menus.attachSourceFile(user, shopId, menuId, file);
  }

  @Delete(':menuId/source')
  @RequireAnyPermissions('shops.manage', 'orderingCatalog.manage')
  clearSource(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('menuId') menuId: string,
  ) {
    return this.menus.clearSourceFile(user, shopId, menuId);
  }
}

@ApiTags('public-menu')
@Controller('public/shops')
export class PublicMenuController {
  constructor(private readonly menus: MenuService) {}

  @Public()
  @Get(':slug/menu/:menuSlug/file')
  async publicMenuFile(
    @Param('slug') slug: string,
    @Param('menuSlug') menuSlug: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, fileName, mime } = await this.menus.publicMenuFile(slug, menuSlug);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return stream;
  }

  @Public()
  @Get(':slug/menu-items/:itemId/image')
  async publicItemImage(
    @Param('slug') slug: string,
    @Param('itemId') itemId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, fileName, mime } = await this.menus.publicItemImage(slug, itemId);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return stream;
  }

  @Public()
  @Get(':slug/menu/:menuSlug')
  publicMenuBySlug(
    @Param('slug') slug: string,
    @Param('menuSlug') menuSlug: string,
  ) {
    return this.menus.publicMenu(slug, menuSlug);
  }

  @Public()
  @Get(':slug/menu')
  publicMenu(@Param('slug') slug: string) {
    return this.menus.publicMenu(slug);
  }
}
