import {
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  AuthUser,
  CurrentUser,
  Public,
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { PrintAgentService } from './print-agent.service';

@ApiTags('print-agent')
@Controller('print-agent')
export class PrintAgentController {
  constructor(private readonly service: PrintAgentService) {}

  @Public()
  @Get('session')
  session(@Headers('authorization') authorization?: string) {
    return this.service
      .resolveShopFromToken(authorization)
      .then((shop) => this.service.session(shop));
  }

  @Public()
  @Get('menu')
  menu(@Headers('authorization') authorization?: string) {
    return this.service
      .resolveShopFromToken(authorization)
      .then((shop) => this.service.getMenu(shop));
  }

  @Public()
  @Get('jobs')
  jobs(@Headers('authorization') authorization?: string) {
    return this.service
      .resolveShopFromToken(authorization)
      .then((shop) => this.service.listPendingJobs(shop));
  }

  @Public()
  @Post('jobs/:id/ack')
  ack(
    @Headers('authorization') authorization?: string,
    @Param('id') id?: string,
    @Body() body?: { status?: string; error?: string | null },
  ) {
    return this.service
      .resolveShopFromToken(authorization)
      .then((shop) => this.service.ackJob(shop, String(id ?? ''), body ?? {}));
  }

  @Public()
  @Post('jobs/test')
  test(@Headers('authorization') authorization?: string) {
    return this.service
      .resolveShopFromToken(authorization)
      .then((shop) => this.service.enqueueTest(shop));
  }
}

@ApiTags('shops-print-agent')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/print-agent')
export class ShopPrintAgentController {
  constructor(private readonly service: PrintAgentService) {}

  @Get()
  @RequireAnyPermissions('shopConfig.read', 'shopConfig.manage', 'shops.manage')
  status(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.service.getAdminStatus(user, shopId);
  }

  @Post('token')
  @RequireAnyPermissions('shopConfig.manage', 'shops.manage')
  generate(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.service.generateToken(user, shopId);
  }

  @Delete('token')
  @RequireAnyPermissions('shopConfig.manage', 'shops.manage')
  revoke(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.service.revokeToken(user, shopId);
  }

  @Get('installer/meta')
  @RequireAnyPermissions('shopConfig.read', 'shopConfig.manage', 'shops.manage')
  installerMeta() {
    return this.service.getInstallerMetaPublic();
  }

  @Get('installer/:os')
  @RequireAnyPermissions('shopConfig.read', 'shopConfig.manage', 'shops.manage')
  async downloadInstaller(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('os') os: string,
    @Res() res: Response,
  ) {
    const file = await this.service.downloadInstallerForShop(user, shopId, os);
    if (file.kind === 'url') {
      res.redirect(302, file.url);
      return;
    }
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName.replace(/["\\\r\n]/g, '_')}"`,
    );
    res.send(file.buffer);
  }
}

@ApiTags('admin-print-agent-installer')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('admin/print-agent-installer')
export class AdminPrintAgentInstallerController {
  constructor(private readonly service: PrintAgentService) {}

  @Get()
  meta(@CurrentUser() user: AuthUser) {
    return this.service.getInstallerMetaAdmin(user);
  }

  @Get(':os/download')
  download(
    @CurrentUser() user: AuthUser,
    @Param('os') os: string,
    @Res() res: Response,
  ) {
    const file = this.service.downloadInstallerAdmin(user, os);
    if (file.kind === 'url') {
      res.redirect(302, file.url);
      return;
    }
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName.replace(/["\\\r\n]/g, '_')}"`,
    );
    res.send(file.buffer);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        os: { type: 'string', enum: ['windows', 'macos', 'linux'] },
        version: { type: 'string' },
      },
      required: ['file', 'os', 'version'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 180 * 1024 * 1024 },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { os?: string; version?: string },
  ) {
    return this.service.uploadInstaller(user, file, {
      os: body?.os,
      version: body?.version,
    });
  }

  @Post('link')
  setLink(
    @CurrentUser() user: AuthUser,
    @Body() body: { os?: string; version?: string; downloadUrl?: string },
  ) {
    return this.service.setInstallerUrl(user, {
      os: body?.os,
      version: body?.version,
      downloadUrl: body?.downloadUrl,
    });
  }

  @Delete(':os')
  remove(@CurrentUser() user: AuthUser, @Param('os') os: string) {
    return this.service.deleteInstaller(user, os);
  }
}
