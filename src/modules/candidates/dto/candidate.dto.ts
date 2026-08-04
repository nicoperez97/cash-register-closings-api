import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CandidateStatus } from '../../../entities/candidate.entity';

class EducationItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() institution?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() degree?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() period?: string;
}

class ExperienceItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() company?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() role?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() period?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

class LanguageItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() level?: string;
}

export class CreateCandidateDto {
  @ApiProperty() @IsString() @MinLength(1) firstName: string;
  @ApiProperty() @IsString() @MinLength(1) lastName: string;

  @ApiPropertyOptional() @IsOptional() @IsString() email?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() documentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() country?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() birthDate?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() nationality?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() linkedIn?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() website?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() summary?: string | null;

  @ApiPropertyOptional({ type: [EducationItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EducationItemDto)
  education?: EducationItemDto[] | null;

  @ApiPropertyOptional({ type: [ExperienceItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExperienceItemDto)
  experience?: ExperienceItemDto[] | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[] | null;

  @ApiPropertyOptional({ type: [LanguageItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LanguageItemDto)
  languages?: LanguageItemDto[] | null;

  @ApiPropertyOptional() @IsOptional() @IsString() rawText?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;

  @ApiPropertyOptional({ enum: CandidateStatus })
  @IsOptional()
  @IsEnum(CandidateStatus)
  status?: CandidateStatus;
}

export class UpdateCandidateDto extends PartialType(CreateCandidateDto) {}
