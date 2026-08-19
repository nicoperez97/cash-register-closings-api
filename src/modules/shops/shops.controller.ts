import {
  Body,
  Controller,
  Get,
  Header,
  MessageEvent,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  Sse,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Observable } from 'rxjs';
import { from, switchMap, throwError } from 'rxjs';
import type { Response } from 'express';
import { ShopLiveService } from '../shop-live/shop-live.service';
import { ShopsService } from './shops.service';
import { ShopBackupService } from './shop-backup.service';
import { CurrentUser, AuthUser, RequirePermissions, Public } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { CreateShopDto, UpdateShopDto } from './dto/shop.dto';

@ApiTags('shops')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops')
export class ShopsController {
  constructor(
    private readonly shops: ShopsService,
    private readonly backup: ShopBackupService,
  ) {}

  @Get('mine')
  @RequirePermissions('closings.read')
  mine(@CurrentUser() user: AuthUser) {
    return this.shops.mine(user);
  }

  @Get()
  @RequirePermissions('closings.read')
  findAll(@CurrentUser() user: AuthUser) {
    return this.shops.findAll(user);
  }

  /** Listado para selects de cierre (cajeros incluidos: solo acceso al local). */
  @Get(':id/users')
  listUsers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shops.listUsers(user, id);
  }

  @Get(':id/backup.xlsx')
  @RequirePermissions('shops.manage')
  async downloadBackup(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.backup.exportBackup(user, id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post(':id/backup/restore')
  @RequirePermissions('shops.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  restoreBackup(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('force') force?: string,
  ) {
    return this.backup.importBackup(user, id, file, force === '1' || force === 'true');
  }

  @Post(':id/reset')
  @RequirePermissions('shops.manage')
  reset(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { confirm?: string },
  ) {
    return this.backup.resetShop(user, id, body?.confirm);
  }

  @Get(':id')
  @RequirePermissions('closings.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shops.findOne(user, id);
  }

  @Post()
  @RequirePermissions('shops.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateShopDto) {
    return this.shops.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('shops.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateShopDto,
  ) {
    return this.shops.update(user, id, dto);
  }

  @Post(':id/logo')
  @RequirePermissions('shops.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadLogo(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.shops.uploadLogo(user, id, file);
  }
}

/** Logo público same-origin para iconos de push (el SW no puede usar Drive a veces). */
@ApiTags('public-shops')
@Controller('public/shops')
export class PublicShopsController {
  constructor(
    private readonly shops: ShopsService,
    private readonly live: ShopLiveService,
  ) {}

  @Public()
  @Sse(':slug/live')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  liveStream(@Param('slug') slug: string): Observable<MessageEvent> {
    return from(this.shops.findActiveBySlug(String(slug ?? '').trim().toLowerCase())).pipe(
      switchMap((shop) => {
        if (!shop) return throwError(() => new NotFoundException('Local no encontrado'));
        return this.live.stream(shop.id);
      }),
    );
  }

  @Public()
  @Get(':shopId/logo')
  async logo(@Param('shopId') shopId: string, @Res() res: Response) {
    const result = await this.shops.fetchPublicLogo(shopId);
    if (!result) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.send(result.buffer);
  }
}
