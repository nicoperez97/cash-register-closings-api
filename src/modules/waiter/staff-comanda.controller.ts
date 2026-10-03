import { Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  AuthUser,
  CurrentUser,
  RequireAnyPermissions,
} from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { WaiterService } from './waiter.service';

@ApiTags('comanda')
@ApiBearerAuth()
@Controller('shops/:shopId/comanda')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class StaffComandaController {
  constructor(private readonly waiter: WaiterService) {}

  /** Emite un token de comanda para el usuario logueado (sin PIN). */
  @Post('enter')
  @RequireAnyPermissions('comanda.manage', 'shops.manage')
  enter(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.waiter.staffEnter(user, shopId);
  }

  /** Mozos para asignar al abrir una mesa desde la web admin. */
  @Get('waiters')
  @RequireAnyPermissions('comanda.manage', 'shops.manage')
  waiters(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.waiter.listStaffWaiters(user, shopId);
  }

  /** Historial de comprobantes (mesas y mostrador cerrados). */
  @Get('receipts')
  @RequireAnyPermissions('comanda.manage', 'shops.manage')
  receipts(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('channel') channel?: string,
    @Query('paymentKind') paymentKind?: string,
    @Query('waiterEmployeeId') waiterEmployeeId?: string,
    @Query('hasTip') hasTip?: string,
  ) {
    return this.waiter.listStaffReceipts(user, shopId, {
      from,
      to,
      q,
      channel,
      paymentKind,
      waiterEmployeeId,
      hasTip,
    });
  }

  /** Excel del historial de comprobantes (mismos filtros). */
  @Get('receipts/export.xlsx')
  @RequireAnyPermissions('comanda.manage', 'shops.manage')
  async receiptsExport(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('channel') channel?: string,
    @Query('paymentKind') paymentKind?: string,
    @Query('waiterEmployeeId') waiterEmployeeId?: string,
    @Query('hasTip') hasTip?: string,
  ) {
    const { buffer, filename } = await this.waiter.exportStaffReceiptsExcel(user, shopId, {
      from,
      to,
      q,
      channel,
      paymentKind,
      waiterEmployeeId,
      hasTip,
    });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /** Detalle de un comprobante cerrado. */
  @Get('receipts/:sessionId')
  @RequireAnyPermissions('comanda.manage', 'shops.manage')
  receipt(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.waiter.getStaffReceipt(user, shopId, sessionId);
  }

  /** Tablero de monitoreo: mesas abiertas, envíos y cambios del turno. */
  @Get('monitor')
  @RequireAnyPermissions('comanda.manage', 'shops.manage')
  monitor(@CurrentUser() user: AuthUser, @Param('shopId') shopId: string) {
    return this.waiter.staffMonitor(user, shopId);
  }
}
