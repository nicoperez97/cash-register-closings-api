import { Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, AuthUser } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('shopId') shopId?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notifications.list(user, {
      shopId,
      unreadOnly: unreadOnly === '1' || unreadOnly === 'true',
    });
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser, @Query('shopId') shopId?: string) {
    return this.notifications.unreadCount(user, shopId);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthUser, @Query('shopId') shopId?: string) {
    return this.notifications.markAllRead(user, shopId);
  }
}
