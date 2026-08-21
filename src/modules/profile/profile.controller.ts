import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { AuthUser, CurrentUser, Public } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { ProfileService } from './profile.service';

const avatarUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, fieldSize: 2 * 1024 * 1024 },
});

class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  bankAlias?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  cbu?: string | null;
}

class UpdateShopPreferencesDto {
  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  navConfig?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mutedNotificationTypes?: string[] | null;
}

@ApiTags('profile')
@Controller()
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Get('profile')
  getSelf(@CurrentUser() user: AuthUser) {
    return this.profile.getSelf(user);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Patch('profile')
  updateSelf(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.profile.updateSelf(user, dto);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Post('profile/avatar')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(avatarUpload)
  uploadAvatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Adjuntá una imagen');
    return this.profile.uploadAvatar(user, file);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Delete('profile/avatar')
  removeAvatar(@CurrentUser() user: AuthUser) {
    return this.profile.removeAvatar(user);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Get('shops/:shopId/profile/preferences')
  getPreferences(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.profile.getShopPreferences(user, shopId);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Patch('shops/:shopId/profile/preferences')
  updatePreferences(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: UpdateShopPreferencesDto,
  ) {
    return this.profile.updateShopPreferences(user, shopId, dto as any);
  }

  /** Público para <img src> sin Bearer (misma idea que logo del local). */
  @Public()
  @Get('public/users/:id/avatar')
  async publicAvatar(@Param('id') id: string, @Res() res: Response) {
    const file = await this.profile.fetchAvatar(id);
    if (!file) throw new NotFoundException('Sin foto de perfil');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(file.buffer);
  }
}
