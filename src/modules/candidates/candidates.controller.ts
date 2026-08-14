import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { CandidatesService } from './candidates.service';
import { CreateCandidateDto, UpdateCandidateDto } from './dto/candidate.dto';

@ApiTags('candidates')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/candidates')
export class CandidatesController {
  constructor(private readonly candidates: CandidatesService) {}

  @Post('parse')
  @RequirePermissions('candidates.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Una o más fotos/PDF del mismo CV',
        },
      },
      required: ['files'],
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', 10, { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  parse(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) throw new BadRequestException('Archivo requerido');
    return this.candidates.parse(user, shopId, files);
  }

  @Get()
  @RequirePermissions('candidates.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('status') status?: string,
  ) {
    return this.candidates.list(user, shopId, status);
  }

  @Get(':id')
  @RequirePermissions('candidates.read')
  one(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.candidates.one(user, shopId, id);
  }

  @Post()
  @RequirePermissions('candidates.manage')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateCandidateDto,
  ) {
    return this.candidates.create(user, shopId, dto);
  }

  @Post(':id/cv-files')
  @RequirePermissions('candidates.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 10, { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  attachCvFiles(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) throw new BadRequestException('Archivo requerido');
    return this.candidates.attachCvFiles(user, shopId, id, files);
  }

  @Get(':id/cv-files/:index')
  @RequirePermissions('candidates.read')
  async downloadCvFile(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Param('index') index: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const n = Number(index);
    if (!Number.isInteger(n) || n < 0) {
      throw new BadRequestException('Archivo inválido');
    }
    const { stream, fileName, mime } = await this.candidates.downloadCvFile(
      user,
      shopId,
      id,
      n,
    );
    res.setHeader('Content-Type', mime);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(fileName)}"`,
    );
    return stream;
  }

  @Patch(':id')
  @RequirePermissions('candidates.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCandidateDto,
  ) {
    return this.candidates.update(user, shopId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('candidates.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.candidates.remove(user, shopId, id);
  }
}
