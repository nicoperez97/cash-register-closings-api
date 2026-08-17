import {
  Body,
  Controller,
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
import { AuthUser, CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { MenuService } from './menu.service';
import { ShopMenu } from './menu-parse.util';

@ApiTags('menu')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/menu')
export class MenuController {
  constructor(private readonly menus: MenuService) {}

  @Get()
  @RequirePermissions('shops.manage')
  get(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.menus.getAdmin(user, shopId);
  }

  @Put()
  @RequirePermissions('shops.manage')
  save(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() body: { menus?: ShopMenu[] } | ShopMenu,
  ) {
    return this.menus.saveAdmin(user, shopId, body);
  }

  @Post('parse')
  @RequirePermissions('shops.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  parse(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.menus.parseUpload(user, shopId, file);
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
