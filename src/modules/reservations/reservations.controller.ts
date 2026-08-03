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
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, AuthUser, RequirePermissions, Public } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { ReservationArea, ReservationStatus } from '../../entities/reservation.entity';
import { WaitingListStatus } from '../../entities/waiting-list-entry.entity';
import { ReservationsService } from './reservations.service';

class CreateReservationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() businessDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() guestName?: string;
  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  partySize: number;
  @ApiPropertyOptional({ enum: ReservationArea, default: ReservationArea.INSIDE })
  @IsOptional()
  @IsEnum(ReservationArea)
  area?: ReservationArea;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reservationTime?: string;
  @ApiPropertyOptional({ enum: ReservationStatus })
  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;
}

class UpdateReservationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() businessDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() guestName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  partySize?: number;
  @ApiPropertyOptional({ enum: ReservationArea })
  @IsOptional()
  @IsEnum(ReservationArea)
  area?: ReservationArea;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() reservationTime?: string | null;
  @ApiPropertyOptional({ enum: ReservationStatus })
  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;
}

class CreateWaitingDto {
  @ApiProperty() @IsString() @MinLength(1) guestName: string;
  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  partySize: number;
  @ApiPropertyOptional({ example: '+59899123456' })
  @IsOptional()
  @IsString()
  phone?: string;
  @ApiPropertyOptional({ enum: ReservationArea, default: ReservationArea.INSIDE })
  @IsOptional()
  @IsEnum(ReservationArea)
  area?: ReservationArea;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

class UpdateWaitingDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) guestName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  partySize?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional({ enum: ReservationArea })
  @IsOptional()
  @IsEnum(ReservationArea)
  area?: ReservationArea;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
  @ApiPropertyOptional({ enum: WaitingListStatus })
  @IsOptional()
  @IsEnum(WaitingListStatus)
  status?: WaitingListStatus;
}

@ApiTags('reservations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get('reservations')
  @RequirePermissions('reservations.read')
  listReservations(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('date') date?: string,
  ) {
    return this.reservations.listReservations(user, shopId, date);
  }

  @Post('reservations')
  @RequirePermissions('reservations.manage')
  createReservation(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateReservationDto,
  ) {
    return this.reservations.createReservation(user, shopId, dto);
  }

  @Patch('reservations/:id')
  @RequirePermissions('reservations.manage')
  updateReservation(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReservationDto,
  ) {
    return this.reservations.updateReservation(user, shopId, id, dto);
  }

  @Delete('reservations/:id')
  @RequirePermissions('reservations.manage')
  removeReservation(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.reservations.removeReservation(user, shopId, id);
  }

  @Get('waiting-list')
  @RequirePermissions('waitingList.read')
  listWaiting(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('includeDone') includeDone?: string,
  ) {
    return this.reservations.listWaiting(user, shopId, includeDone === '1' || includeDone === 'true');
  }

  @Post('waiting-list')
  @RequirePermissions('waitingList.manage')
  createWaiting(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateWaitingDto,
  ) {
    return this.reservations.createWaiting(user, shopId, dto);
  }

  @Patch('waiting-list/:id')
  @RequirePermissions('waitingList.manage')
  updateWaiting(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWaitingDto,
  ) {
    return this.reservations.updateWaiting(user, shopId, id, dto);
  }

  @Delete('waiting-list/:id')
  @RequirePermissions('waitingList.manage')
  removeWaiting(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.reservations.removeWaiting(user, shopId, id);
  }
}

@ApiTags('public-reservations')
@Controller('public/shops')
export class PublicReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Public()
  @Get(':slug/reservations')
  board(@Param('slug') slug: string, @Query('date') date?: string) {
    return this.reservations.publicBoard(slug, date);
  }

  @Public()
  @Get(':slug/waiting-list')
  waitingBoard(@Param('slug') slug: string) {
    return this.reservations.publicWaitingBoard(slug);
  }
}
