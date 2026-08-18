import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ClosingSourcesService } from './closing-sources.service';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import {
  UpdateShopClosingSourceDto,
  UpsertShopClosingSourceDto,
} from './dto/closing-source.dto';

@ApiTags('closing-sources')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/closing-sources')
export class ClosingSourcesController {
  constructor(private readonly sources: ClosingSourcesService) {}

  @Get()
  @RequirePermissions('closings.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.sources.list(user, shopId, activeOnly === 'true');
  }

  @Post()
  @RequirePermissions('shops.manage')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: UpsertShopClosingSourceDto,
  ) {
    return this.sources.create(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('shops.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateShopClosingSourceDto,
  ) {
    return this.sources.update(user, shopId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('shops.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.sources.remove(user, shopId, id);
  }
}
