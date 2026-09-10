import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Public } from '../../common/decorators';
import {
  CurrentDineIn,
  DineInAuthGuard,
  DineInAuthPayload,
} from './dine-in-auth';
import { DineInService } from './dine-in.service';

class OpenDineInSessionDto {
  @ApiProperty()
  @IsUUID()
  salonTableId: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  covers: number;
}

class DineInOrderItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  menuItemId: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  qty: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  removedIngredients?: string[];
}

class DineInOrderExtraDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  extraId: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  qty: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  attachedToMenuItemId?: string | null;
}

class CreateDineInOrderDto {
  @ApiProperty({ type: [DineInOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => DineInOrderItemDto)
  items: DineInOrderItemDto[];

  @ApiPropertyOptional({ type: [DineInOrderExtraDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => DineInOrderExtraDto)
  extras?: DineInOrderExtraDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNotes?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  printKitchen?: boolean;
}

@ApiTags('public-dine-in')
@Controller('public/shops/:slug/dine-in')
export class DineInController {
  constructor(private readonly dineIn: DineInService) {}

  @Public()
  @Get('floor')
  floor(@Param('slug') slug: string) {
    return this.dineIn.getFloor(slug);
  }

  @Public()
  @Post('sessions')
  openSession(@Param('slug') slug: string, @Body() dto: OpenDineInSessionDto) {
    return this.dineIn.openSession(slug, dto.salonTableId, dto.covers);
  }

  @Public()
  @UseGuards(DineInAuthGuard)
  @Get('session')
  resume(
    @Param('slug') slug: string,
    @CurrentDineIn() guest: DineInAuthPayload,
  ) {
    return this.dineIn.resumeSession(slug, guest);
  }

  @Public()
  @UseGuards(DineInAuthGuard)
  @Post('session/discard')
  discard(
    @Param('slug') slug: string,
    @CurrentDineIn() guest: DineInAuthPayload,
  ) {
    return this.dineIn.discardSession(slug, guest);
  }

  @Public()
  @UseGuards(DineInAuthGuard)
  @Post('session/orders')
  createOrder(
    @Param('slug') slug: string,
    @CurrentDineIn() guest: DineInAuthPayload,
    @Body() dto: CreateDineInOrderDto,
  ) {
    return this.dineIn.createSessionOrder(slug, guest, dto);
  }
}
