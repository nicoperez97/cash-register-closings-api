import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser, AuthUser, RequirePermissions, Public } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { ReservationArea, ReservationStatus } from '../../entities/reservation.entity';
import { WaitingListStatus } from '../../entities/waiting-list-entry.entity';
import { ReservationsService } from './reservations.service';
import { ReservationRequestsService } from './reservation-requests.service';

class CreateReservationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() businessDate?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  guestName?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsEmail()
  guestEmail?: string | null;
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
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reservationTime?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tableNumber?: string | null;
}

class UpdateReservationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() businessDate?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  guestName?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsEmail()
  guestEmail?: string | null;
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
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() reservationTime?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tableNumber?: string | null;
  @ApiPropertyOptional({ enum: ReservationStatus })
  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;
}

class CreateWaitingDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) guestName: string;
  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  partySize: number;
  @ApiPropertyOptional({ example: '+59899123456' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
  @ApiPropertyOptional({ enum: ReservationArea, default: ReservationArea.INSIDE })
  @IsOptional()
  @IsEnum(ReservationArea)
  area?: ReservationArea;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

class UpdateWaitingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  guestName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  partySize?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
  @ApiPropertyOptional({ enum: ReservationArea })
  @IsOptional()
  @IsEnum(ReservationArea)
  area?: ReservationArea;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
  @ApiPropertyOptional({ enum: WaitingListStatus })
  @IsOptional()
  @IsEnum(WaitingListStatus)
  status?: WaitingListStatus;
}

class CreatePublicReservationRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  guestName: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(180)
  guestEmail: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  instagramHandle?: string | null;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  partySize: number;

  @ApiProperty({ example: '2026-08-15' })
  @IsString()
  businessDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reservationTime?: string | null;

  @ApiPropertyOptional({ enum: ReservationArea })
  @IsOptional()
  @IsEnum(ReservationArea)
  area?: ReservationArea;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  guestComment?: string | null;

  /** Honeypot anti-spam: debe ir vacío. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  website?: string | null;
}

class DecideReservationRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  staffNote?: string | null;
}

class SetReservationSignupDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

class SetReservationAreasDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  inside?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  outside?: boolean;
}

class SetReservationPartyRulesDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  insideMaxPartySize?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Máx. personas afuera. NULL = ilimitado.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  outsideMaxPartySize?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  outsideMinPartySize?: number | null;
}

class SendReservationMessageDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  message: string;
}

class UpsertDayNoticeDto {
  @ApiPropertyOptional({ description: 'YYYY-MM-DD; default hoy del local' })
  @IsOptional()
  @IsString()
  businessDate?: string;

  @ApiPropertyOptional({
    description: 'Texto del aviso. Vacío elimina el aviso del día.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'NULL hereda del local; false cierra el formulario web ese día.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  signupEnabled?: boolean | null;

  @ApiPropertyOptional({ nullable: true, description: 'NULL hereda; false desactiva adentro.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  insideEnabled?: boolean | null;

  @ApiPropertyOptional({ nullable: true, description: 'NULL hereda; false desactiva afuera.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  outsideEnabled?: boolean | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cupo restante de personas adentro. NULL = sin límite; 0 = sin cupo.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  insideCapacityRemaining?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cupo restante de personas afuera. NULL = sin límite; 0 = sin cupo.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  outsideCapacityRemaining?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Máx. personas adentro este día. NULL hereda del local.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  insideMaxPartySize?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Máx. personas afuera. NULL = ilimitado.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  outsideMaxPartySize?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Máx. personas afuera este día. NULL hereda del local. Vacío = ilimitado.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  outsideMinPartySize?: number | null;
}

@ApiTags('reservations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId')
export class ReservationsController {
  constructor(
    private readonly reservations: ReservationsService,
    private readonly requests: ReservationRequestsService,
  ) {}

  @Get('reservations/summary')
  @RequirePermissions('reservations.read')
  reservationsSummary(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reservations.reservationsSummary(user, shopId, from, to);
  }

  @Get('reservations')
  @RequirePermissions('reservations.read')
  listReservations(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('date') date?: string,
  ) {
    return this.reservations.listReservations(user, shopId, date);
  }

  @Patch('reservation-signup')
  @RequirePermissions('reservations.manage')
  setReservationSignup(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: SetReservationSignupDto,
  ) {
    return this.requests.setSignupEnabled(user, shopId, dto.enabled);
  }

  @Patch('reservation-areas')
  @RequirePermissions('reservations.manage')
  setReservationAreas(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: SetReservationAreasDto,
  ) {
    return this.requests.setAreasEnabled(user, shopId, dto);
  }

  @Patch('reservation-party-rules')
  @RequirePermissions('reservations.manage')
  setReservationPartyRules(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: SetReservationPartyRulesDto,
  ) {
    return this.requests.setPartyRules(user, shopId, dto);
  }

  @Get('reservation-requests')
  @RequirePermissions('reservations.read')
  listReservationRequests(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('status') status?: string,
  ) {
    return this.requests.list(user, shopId, status);
  }

  @Get('reservation-requests/pending-count')
  @RequirePermissions('reservations.read')
  pendingReservationRequests(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
  ) {
    return this.requests.pendingCount(user, shopId);
  }

  @Post('reservation-requests/:id/accept')
  @RequirePermissions('reservations.manage')
  acceptReservationRequest(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: DecideReservationRequestDto,
  ) {
    return this.requests.accept(user, shopId, id, dto?.staffNote);
  }

  @Post('reservation-requests/:id/reject')
  @RequirePermissions('reservations.manage')
  rejectReservationRequest(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: DecideReservationRequestDto,
  ) {
    return this.requests.reject(user, shopId, id, dto?.staffNote);
  }

  @Delete('reservation-requests/:id')
  @RequirePermissions('reservations.manage')
  removeReservationRequest(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.requests.remove(user, shopId, id);
  }

  @Put('reservation-day-notices')
  @RequirePermissions('reservations.manage')
  upsertDayNotice(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: UpsertDayNoticeDto,
  ) {
    return this.reservations.upsertDayNotice(user, shopId, dto);
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

  @Post('reservations/:id/message')
  @RequirePermissions('reservations.manage')
  sendReservationMessage(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: SendReservationMessageDto,
  ) {
    return this.reservations.sendGuestMessage(user, shopId, id, dto.message);
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

class PublicSeatReservationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tableNumber?: string | null;
}

@ApiTags('public-reservations')
@Controller('public/shops')
export class PublicReservationsController {
  constructor(
    private readonly reservations: ReservationsService,
    private readonly requests: ReservationRequestsService,
  ) {}

  @Public()
  @Get(':slug/reservation-signup')
  signupInfo(@Param('slug') slug: string, @Query('date') date?: string) {
    return this.requests.publicSignupInfo(slug, date);
  }

  @Public()
  @Get(':slug/my-reservations')
  lookupByEmail(@Param('slug') slug: string, @Query('email') email?: string) {
    return this.reservations.publicLookupByEmail(slug, String(email ?? ''));
  }

  @Public()
  @Post(':slug/reservation-requests')
  createPublicRequest(
    @Param('slug') slug: string,
    @Body() dto: CreatePublicReservationRequestDto,
  ) {
    return this.requests.createPublic(slug, dto);
  }

  @Public()
  @Get(':slug/reservations')
  board(@Param('slug') slug: string) {
    return this.reservations.publicBoard(slug);
  }

  @Public()
  @Post(':slug/reservations/:id/seat')
  seat(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Body() dto?: PublicSeatReservationDto,
  ) {
    return this.reservations.publicSeatReservation(slug, id, dto?.tableNumber);
  }

  @Public()
  @Delete(':slug/reservations/:id/dismiss')
  dismiss(
    @Param('slug') slug: string,
    @Param('id') id: string,
  ) {
    return this.reservations.publicDismissRemovedReservation(slug, id);
  }

  @Public()
  @Get(':slug/waiting-list')
  waitingBoard(@Param('slug') slug: string) {
    return this.reservations.publicWaitingBoard(slug);
  }

  /** Manifest PWA del tablero de reservas (mismo origen vía proxy o /api en prod). */
  @Public()
  @Get(':slug/manifests/reservations')
  @Header('Content-Type', 'application/manifest+json; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  reservationsManifest(
    @Param('slug') slug: string,
    @Query('appOrigin') appOrigin?: string,
  ) {
    return this.reservations.buildBoardPwaManifest(slug, 'reservations', appOrigin);
  }

  /** Manifest PWA del tablero de lista de espera. */
  @Public()
  @Get(':slug/manifests/waiting')
  @Header('Content-Type', 'application/manifest+json; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  waitingManifest(
    @Param('slug') slug: string,
    @Query('appOrigin') appOrigin?: string,
  ) {
    return this.reservations.buildBoardPwaManifest(slug, 'waiting', appOrigin);
  }
}
