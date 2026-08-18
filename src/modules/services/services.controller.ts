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
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { ServicesService } from './services.service';

class CreateServiceDto {
  @ApiProperty() @IsString() @MinLength(1) name: string;
  @ApiPropertyOptional({ description: 'Razón social' })
  @IsOptional()
  @IsString()
  legalName?: string | null;
  @ApiPropertyOptional({ description: 'CUIT' })
  @IsOptional()
  @IsString()
  taxId?: string | null;
  @ApiPropertyOptional({ description: 'Alias o CBU' })
  @IsOptional()
  @IsString()
  bankAlias?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateServiceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) name?: string;
  @ApiPropertyOptional({ description: 'Razón social' })
  @IsOptional()
  @IsString()
  legalName?: string | null;
  @ApiPropertyOptional({ description: 'CUIT' })
  @IsOptional()
  @IsString()
  taxId?: string | null;
  @ApiPropertyOptional({ description: 'Alias o CBU' })
  @IsOptional()
  @IsString()
  bankAlias?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('services')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @RequirePermissions('services.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.services.list(user, shopId, includeInactive === 'true');
  }

  @Get(':id')
  @RequirePermissions('services.read')
  one(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.services.one(user, shopId, id);
  }

  @Post()
  @RequirePermissions('services.manage')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateServiceDto,
  ) {
    return this.services.create(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('services.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.services.update(user, shopId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('services.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.services.remove(user, shopId, id);
  }
}
