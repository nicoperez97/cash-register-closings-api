import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { PaymentsService } from './payments.service';

class CreatePaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsNumber()
  @Min(0)
  amount?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsDateString()
  dueDate?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  payerUserId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  validatorUserId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  accountId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  supplierId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  employeeId?: string | null;
}

class UpdatePaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsNumber()
  @Min(0)
  amount?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsDateString()
  dueDate?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  payerUserId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  validatorUserId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  accountId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  supplierId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  employeeId?: string | null;
}

class PayPaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() paidAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
}

class RejectPaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions('payments.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('status') status?: string,
  ) {
    return this.payments.list(user, shopId, status);
  }

  @Get('export.xlsx')
  @RequirePermissions('payments.read')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('status') status: string | undefined,
    @Query('kind') kind: string | undefined,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.payments.exportExcel(
      user,
      shopId,
      status,
      kind,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get(':id')
  @RequirePermissions('payments.read')
  one(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.payments.one(user, shopId, id);
  }

  @Post()
  @RequirePermissions('payments.manage')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.payments.create(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('payments.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.payments.update(user, shopId, id, dto);
  }

  @Post(':id/validate')
  @RequirePermissions('payments.read')
  validate(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.payments.validate(user, shopId, id);
  }

  @Post(':id/reject')
  @RequirePermissions('payments.read')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: RejectPaymentDto,
  ) {
    return this.payments.reject(user, shopId, id, dto.reason);
  }

  @Post(':id/pay')
  @RequirePermissions('payments.read')
  pay(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: PayPaymentDto,
  ) {
    return this.payments.pay(user, shopId, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('payments.manage')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.payments.cancel(user, shopId, id);
  }

  @Delete(':id')
  @RequirePermissions('payments.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.payments.remove(user, shopId, id);
  }
}
