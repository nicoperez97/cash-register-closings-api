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
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { MulterExceptionFilter } from '../../common/filters/multer-exception.filter';
import { ReimbursementStatus } from '../../common/enums';
import { ReimbursementsService } from './reimbursements.service';

class CreateMineDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  description: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty()
  @IsDateString()
  expenseDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;
}

class UpdateMineDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expenseDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;
}

class UpdateAliasDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  bankAlias?: string | null;
}

class PayDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  paidAt?: string | null;
}

@ApiTags('reimbursements')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/reimbursements')
export class ReimbursementsController {
  constructor(private readonly reimbursements: ReimbursementsService) {}

  @Get('me')
  @RequirePermissions('reimbursements.self')
  me(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.reimbursements.myProfile(user, shopId);
  }

  @Patch('me/alias')
  @RequirePermissions('reimbursements.self')
  updateAlias(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: UpdateAliasDto,
  ) {
    return this.reimbursements.updateMyAlias(user, shopId, dto.bankAlias ?? null);
  }

  @Get('me/expenses')
  @RequirePermissions('reimbursements.self')
  listMine(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.reimbursements.listMine(user, shopId);
  }

  @Post('me/expenses')
  @RequirePermissions('reimbursements.self')
  createMine(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateMineDto,
  ) {
    return this.reimbursements.createMine(user, shopId, dto);
  }

  @Patch('me/expenses/:id')
  @RequirePermissions('reimbursements.self')
  updateMine(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMineDto,
  ) {
    return this.reimbursements.updateMine(user, shopId, id, dto);
  }

  @Delete('me/expenses/:id')
  @RequirePermissions('reimbursements.self')
  removeMine(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.reimbursements.removeMine(user, shopId, id);
  }

  @Get('pending-count')
  @RequirePermissions('reimbursements.read')
  pendingCount(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.reimbursements.pendingCount(user, shopId);
  }

  @Get()
  @RequirePermissions('reimbursements.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('status') status?: ReimbursementStatus | '',
    @Query('employeeId') employeeId?: string,
  ) {
    return this.reimbursements.list(user, shopId, { status, employeeId });
  }

  @Post(':id/pay')
  @RequirePermissions('reimbursements.manage')
  pay(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: PayDto,
  ) {
    return this.reimbursements.pay(user, shopId, id, dto.paidAt);
  }

  @Post(':id/cancel')
  @RequirePermissions('reimbursements.manage')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.reimbursements.cancel(user, shopId, id);
  }

  @Post(':id/receipt-file')
  @RequirePermissions('reimbursements.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024, fieldSize: 2 * 1024 * 1024 },
    }),
  )
  uploadReceipt(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Archivo requerido');
    return this.reimbursements.uploadReceiptFile(user, shopId, id, file);
  }

  @Get(':id/receipt-file')
  async downloadReceipt(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, fileName, mime } = await this.reimbursements.downloadReceiptFile(
      user,
      shopId,
      id,
    );
    res.setHeader('Content-Type', mime);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(fileName)}"`,
    );
    return stream;
  }
}
