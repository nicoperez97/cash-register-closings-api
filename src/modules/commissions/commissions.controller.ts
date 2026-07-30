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
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { CommissionsService } from './commissions.service';

class CreateCommissionRuleDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty() @IsString() @MinLength(1) category: string;
  @ApiProperty() @IsNumber() @Min(0) ratePercent: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateCommissionRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) ratePercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('commissions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/commissions')
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get('rules')
  @RequirePermissions('commissions.read')
  listRules(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.commissions.listRules(user, shopId, employeeId);
  }

  @Post('rules')
  @RequirePermissions('commissions.manage')
  createRule(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateCommissionRuleDto,
  ) {
    return this.commissions.createRule(user, shopId, dto);
  }

  @Patch('rules/:id')
  @RequirePermissions('commissions.manage')
  updateRule(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCommissionRuleDto,
  ) {
    return this.commissions.updateRule(user, shopId, id, dto);
  }

  @Delete('rules/:id')
  @RequirePermissions('commissions.manage')
  removeRule(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.commissions.removeRule(user, shopId, id);
  }

  @Get('calculate')
  @RequirePermissions('commissions.read')
  calculate(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.commissions.calculate(user, shopId, from, to);
  }

  @Get('export.xlsx')
  @RequirePermissions('commissions.read')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.commissions.exportExcel(
      user,
      shopId,
      from,
      to,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
