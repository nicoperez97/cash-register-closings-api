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
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser, AuthUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { ConceptKind } from '../../common/enums';
import { ConceptsService } from './concepts.service';

class CreateConceptDto {
  @ApiProperty() @IsString() @MinLength(1) name: string;
  @ApiPropertyOptional({ enum: ConceptKind })
  @IsOptional()
  @IsEnum(ConceptKind)
  kind?: ConceptKind;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateConceptDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) name?: string;
  @ApiPropertyOptional({ enum: ConceptKind })
  @IsOptional()
  @IsEnum(ConceptKind)
  kind?: ConceptKind;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('concepts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Controller('shops/:shopId/concepts')
export class ConceptsController {
  constructor(private readonly concepts: ConceptsService) {}

  @Get()
  @RequirePermissions('movements.read')
  list(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Query('kind') kind?: ConceptKind,
  ) {
    return this.concepts.list(user, shopId, kind);
  }

  @Post()
  @RequirePermissions('concepts.manage')
  create(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Body() dto: CreateConceptDto,
  ) {
    return this.concepts.create(user, shopId, dto);
  }

  @Patch(':id')
  @RequirePermissions('concepts.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
    @Body() dto: UpdateConceptDto,
  ) {
    return this.concepts.update(user, shopId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('concepts.manage')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.concepts.remove(user, shopId, id);
  }
}
