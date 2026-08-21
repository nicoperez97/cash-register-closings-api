import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { GlobalRole } from '../../common/enums';
import { UsersService } from './users.service';
import { ProfileService } from '../profile/profile.service';

class CreateUserDto {
  @ApiProperty() @IsString() @MinLength(2) fullName: string;
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MinLength(4) password: string;
  @ApiProperty({ enum: GlobalRole }) @IsEnum(GlobalRole) globalRole: GlobalRole;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() shopIds?: string[];
  @ApiPropertyOptional({ enum: GlobalRole }) @IsOptional() @IsEnum(GlobalRole) shopRole?: GlobalRole;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  @IsOptional()
  modulePermissions?: Record<string, string> | null;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  ledgerAccountIds?: string[];
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  ledgerAccountId?: string | null;
  @ApiPropertyOptional({
    description: 'Legacy: si true, oculta en “Quién se lo lleva” (preferir visibility)',
  })
  @IsOptional()
  @IsBoolean()
  hideFromCashWithdraw?: boolean;
  @ApiPropertyOptional({
    description:
      'Dónde se muestra el usuario (true = visible). Keys: cashWithdraw, closingsFilters, payments, movements, employeeLink, usersList',
    type: 'object',
    additionalProperties: { type: 'boolean' },
  })
  @IsOptional()
  @IsObject()
  visibility?: Record<string, boolean> | null;
  @ApiPropertyOptional({
    description: 'Si es true, recibe alertas cuando el stock de alimentos baja del mínimo',
  })
  @IsOptional()
  @IsBoolean()
  isStockAdmin?: boolean;
  @ApiPropertyOptional({
    description: 'Si es true, recibe alertas cuando el stock de bebidas baja del mínimo',
  })
  @IsOptional()
  @IsBoolean()
  isBeverageStockAdmin?: boolean;
  @ApiPropertyOptional({
    description: 'Si es true, recibe notificaciones y mails del módulo Faltantes',
  })
  @IsOptional()
  @IsBoolean()
  isShortageAdmin?: boolean;
  @ApiPropertyOptional({
    description: 'Si es true, recibe notificaciones y mails de solicitudes de reserva',
  })
  @IsOptional()
  @IsBoolean()
  isReservationAdmin?: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() phone?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() bankAlias?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() cbu?: string | null;
}

class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(4) password?: string;
  @ApiPropertyOptional({ enum: GlobalRole }) @IsOptional() @IsEnum(GlobalRole) globalRole?: GlobalRole;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() shopIds?: string[];
  @ApiPropertyOptional({ enum: GlobalRole }) @IsOptional() @IsEnum(GlobalRole) shopRole?: GlobalRole;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  @IsOptional()
  modulePermissions?: Record<string, string> | null;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  ledgerAccountIds?: string[];
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  ledgerAccountId?: string | null;
  @ApiPropertyOptional({
    description: 'Legacy: si true, oculta en “Quién se lo lleva” (preferir visibility)',
  })
  @IsOptional()
  @IsBoolean()
  hideFromCashWithdraw?: boolean;
  @ApiPropertyOptional({
    description:
      'Dónde se muestra el usuario (true = visible). Keys: cashWithdraw, closingsFilters, payments, movements, employeeLink, usersList',
    type: 'object',
    additionalProperties: { type: 'boolean' },
  })
  @IsOptional()
  @IsObject()
  visibility?: Record<string, boolean> | null;
  @ApiPropertyOptional({
    description: 'Si es true, recibe alertas cuando el stock de alimentos baja del mínimo',
  })
  @IsOptional()
  @IsBoolean()
  isStockAdmin?: boolean;
  @ApiPropertyOptional({
    description: 'Si es true, recibe alertas cuando el stock de bebidas baja del mínimo',
  })
  @IsOptional()
  @IsBoolean()
  isBeverageStockAdmin?: boolean;
  @ApiPropertyOptional({
    description: 'Si es true, recibe notificaciones y mails del módulo Faltantes',
  })
  @IsOptional()
  @IsBoolean()
  isShortageAdmin?: boolean;
  @ApiPropertyOptional({
    description: 'Si es true, recibe notificaciones y mails de solicitudes de reserva',
  })
  @IsOptional()
  @IsBoolean()
  isReservationAdmin?: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() phone?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() bankAlias?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() cbu?: string | null;
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly profile: ProfileService,
  ) {}

  @Get()
  @RequirePermissions('closings.read')
  list(@CurrentUser() user: AuthUser, @Query('shopId') shopId?: string) {
    return this.users.list(user, shopId);
  }

  @Post()
  @RequirePermissions('closings.read')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUserDto,
    @Query('shopId') shopId?: string,
  ) {
    return this.users.create(user, dto, shopId);
  }

  @Get('me-profile')
  @RequirePermissions('closings.read')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post(':id/avatar')
  @RequirePermissions('closings.read')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadAvatar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('shopId') shopId?: string,
  ) {
    if (!this.users.canManageUsersSomewhere(user)) {
      throw new ForbiddenException('Sin permiso para editar usuarios');
    }
    if (shopId) this.users.assertShopUserAdmin(user, shopId);
    if (!file) throw new BadRequestException('Adjuntá una imagen');
    return this.profile.uploadAvatarAsAdmin(id, file);
  }

  @Get(':id')
  @RequirePermissions('closings.read')
  one(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('shopId') shopId?: string,
  ) {
    return this.users.one(user, id, shopId);
  }

  @Patch(':id')
  @RequirePermissions('closings.read')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Query('shopId') shopId?: string,
  ) {
    return this.users.update(user, id, dto, shopId);
  }

  @Delete(':id')
  @RequirePermissions('closings.read')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.remove(user, id);
  }
}
