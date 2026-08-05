import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Type } from 'class-transformer';
import { IsObject, IsString, ValidateNested } from 'class-validator';
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

@ApiTags('push')
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

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
