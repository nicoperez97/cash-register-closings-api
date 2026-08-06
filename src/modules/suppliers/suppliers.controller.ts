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
import { SuppliersService } from './suppliers.service';

class CreateSupplierDto {
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

class UpdateSupplierDto {
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

@ApiTags('suppliers')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions('suppliers.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.suppliers.list(user, shopId, includeInactive === 'true');
  }

  @Get(':id')
  @RequirePermissions('suppliers.read')
  one(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.suppliers.one(user, shopId, id);
  }

  @Post()
  @RequirePermissions('suppliers.manage')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateSupplierDto,
  ) {
    return this.suppliers.create(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('suppliers.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliers.update(user, shopId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('suppliers.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.suppliers.remove(user, shopId, id);
  }
}
