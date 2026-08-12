import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CurrentUser, AuthUser, Public } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { PushService } from './push.service';

class PushKeysDto {
  @ApiProperty() @IsString() p256dh: string;
  @ApiProperty() @IsString() auth: string;
}

class SubscribePushDto {
  @ApiProperty() @IsString() endpoint: string;
  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  @IsObject()
  keys: PushKeysDto;
}

class BroadcastAppUpdateDto {
  @ApiPropertyOptional({ description: 'Identificador de versión (ej. commit SHA)' })
  @IsOptional()
  @IsString()
  version?: string;
}

@ApiTags('push')
@Controller('push')
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly config: ConfigService,
  ) {}

  /** Webhook post-deploy: notifica push a todos los suscriptores (sin mail). */
  @Public()
  @Post('broadcast-app-update')
  broadcastAppUpdate(
    @Headers('x-deploy-secret') secret: string | undefined,
    @Body() dto?: BroadcastAppUpdateDto,
  ) {
    const expected = this.config.get<string>('deployWebhookSecret') ?? '';
    if (!expected || !secret || secret !== expected) {
      throw new UnauthorizedException('No autorizado');
    }
    return this.push.broadcastAppUpdate(dto?.version);
  }

  /** Clave pública VAPID (necesaria para suscribir el navegador). */
  @Public()
  @Get('vapid-public-key')
  vapidPublicKey() {
    const publicKey = this.push.getPublicKey();
    return { publicKey, enabled: !!publicKey };
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Post('subscribe')
  async subscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: SubscribePushDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    try {
      return await this.push.upsertSubscription(user, {
        endpoint: dto.endpoint,
        keys: dto.keys,
        userAgent,
      });
    } catch (err) {
      throw new BadRequestException((err as Error)?.message ?? 'No se pudo suscribir');
    }
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Delete('subscribe')
  unsubscribe(
    @CurrentUser() user: AuthUser,
    @Query('endpoint') endpoint: string,
    @Body() body?: { endpoint?: string },
  ) {
    const ep = endpoint || body?.endpoint;
    if (!ep) throw new BadRequestException('Indicá endpoint');
    return this.push.removeSubscription(user, ep);
  }
}
