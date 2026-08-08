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
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { ShortageLevel } from '../../common/enums';
import { ShortagesService } from './shortages.service';

class CreateShortageDto {
  @ApiProperty() @IsString() @MinLength(1) name: string;
  @ApiProperty({ enum: ShortageLevel })
  @IsEnum(ShortageLevel)
  level: ShortageLevel;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateShortageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) name?: string;
  @ApiPropertyOptional({ enum: ShortageLevel })
  @IsOptional()
  @IsEnum(ShortageLevel)
  level?: ShortageLevel;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('shortages')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/shortages')
export class ShortagesController {
  constructor(private readonly shortages: ShortagesService) {}

  @Get()
  @RequirePermissions('shortages.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.shortages.list(user, shopId, includeInactive === 'true');
  }

  @Get(':id')
  @RequirePermissions('shortages.read')
  one(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.shortages.one(user, shopId, id);
  }

  @Post()
  @RequirePermissions('shortages.manage')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateShortageDto,
  ) {
    return this.shortages.create(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('shortages.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateShortageDto,
  ) {
    return this.shortages.update(user, shopId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('shortages.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.shortages.remove(user, shopId, id);
  }
}
