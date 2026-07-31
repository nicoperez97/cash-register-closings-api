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
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsArray,
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
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

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

  @Get(':id')
  @RequirePermissions('closings.read')
  one(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.one(user, id);
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
