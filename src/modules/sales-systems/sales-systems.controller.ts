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
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { SalesSystemsService } from './sales-systems.service';

class CreateSalesSystemDto {
  @ApiProperty({ example: 'RESTOSOFT' })
  @IsString()
  @MinLength(2)
  code: string;

  @ApiProperty({ example: 'Restosoft' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'restosoft' })
  @IsString()
  @MinLength(2)
  parserKey: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class UpdateSalesSystemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  parserKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

@ApiTags('sales-systems')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('sales-systems')
export class SalesSystemsController {
  constructor(private readonly systems: SalesSystemsService) {}

  /** Listado activo (selector de local / import). Con ?all=1 incluye inactivos (admin). */
  @Get()
  @RequirePermissions('closings.read')
  list(@Query('all') all?: string) {
    if (all === 'true' || all === '1') {
      return this.systems.listAll();
    }
    return this.systems.listActive();
  }

  @Get('parsers')
  @RequirePermissions('shops.manage')
  parsers() {
    return this.systems.listParsers();
  }

  @Post()
  @RequirePermissions('shops.manage')
  create(@Body() dto: CreateSalesSystemDto) {
    return this.systems.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('shops.manage')
  update(@Param('id') id: string, @Body() dto: UpdateSalesSystemDto) {
    return this.systems.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('shops.manage')
  remove(@Param('id') id: string) {
    return this.systems.remove(id);
  }
}
