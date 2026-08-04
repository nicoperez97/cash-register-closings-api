import {
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../../common/decorators';
import { isEntityActive } from '../../common/active.util';
import {
  Candidate,
  CandidateStatus,
} from '../../entities/candidate.entity';
import { ShopsService } from '../shops/shops.service';
import { CreateCandidateDto, UpdateCandidateDto } from './dto/candidate.dto';
import { ocrAndParseCv, ParsedCv } from './cv-ocr.parser';

@Injectable()
export class CandidatesService implements OnModuleInit {
  constructor(
    @InjectRepository(Candidate) private readonly candidates: Repository<Candidate>,
    private readonly shops: ShopsService,
  ) {}

  async onModuleInit() {
    try {
      await this.candidates.query(`
        CREATE TABLE IF NOT EXISTS candidates (
          id CHAR(36) NOT NULL,
          shopId CHAR(36) NOT NULL,
          firstName VARCHAR(120) NOT NULL,
          lastName VARCHAR(120) NOT NULL,
          email VARCHAR(180) NULL,
          phone VARCHAR(60) NULL,
          documentId VARCHAR(60) NULL,
          address VARCHAR(255) NULL,
          city VARCHAR(120) NULL,
          country VARCHAR(120) NULL,
          birthDate DATE NULL,
          nationality VARCHAR(120) NULL,
          linkedIn VARCHAR(255) NULL,
          website VARCHAR(255) NULL,
          summary TEXT NULL,
          education JSON NULL,
          experience JSON NULL,
          skills JSON NULL,
          languages JSON NULL,
          rawText LONGTEXT NULL,
          notes TEXT NULL,
          status ENUM('new', 'reviewing', 'hired', 'rejected') NOT NULL DEFAULT 'new',
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
          deletedAt DATETIME(6) NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          PRIMARY KEY (id),
          KEY idx_candidates_shop (shopId),
          KEY idx_candidates_status (shopId, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch {
      // ya existe o sin permisos DDL
    }
  }

  private toDto(c: Candidate) {
    return {
      id: c.id,
      shopId: c.shopId,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email ?? null,
      phone: c.phone ?? null,
      documentId: c.documentId ?? null,
      address: c.address ?? null,
      city: c.city ?? null,
      country: c.country ?? null,
      birthDate: c.birthDate ?? null,
      nationality: c.nationality ?? null,
      linkedIn: c.linkedIn ?? null,
      website: c.website ?? null,
      summary: c.summary ?? null,
      education: c.education ?? [],
      experience: c.experience ?? [],
      skills: c.skills ?? [],
      languages: c.languages ?? [],
      rawText: c.rawText ?? null,
      notes: c.notes ?? null,
      status: c.status ?? CandidateStatus.NEW,
      active: isEntityActive(c.active),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt ?? null,
    };
  }

  async parse(
    user: AuthUser,
    shopId: string,
    files: Express.Multer.File | Express.Multer.File[],
  ): Promise<ParsedCv> {
    this.shops.assertShopAccess(user, shopId);
    return ocrAndParseCv(files);
  }

  async list(user: AuthUser, shopId: string, status?: string) {
    this.shops.assertShopAccess(user, shopId);
    const rows = await this.candidates.find({
      where: { shopId },
      order: { createdAt: 'DESC' },
    });
    const filtered = status
      ? rows.filter((r) => r.status === status)
      : rows.filter((r) => isEntityActive(r.active));
    return filtered.map((r) => this.toDto(r));
  }

  async one(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.candidates.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Candidato no encontrado');
    return this.toDto(row);
  }

  async create(user: AuthUser, shopId: string, dto: CreateCandidateDto) {
    this.shops.assertShopAccess(user, shopId);
    const row = this.candidates.create({
      shopId,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      email: dto.email?.trim() || null,
      phone: dto.phone?.trim() || null,
      documentId: dto.documentId?.trim() || null,
      address: dto.address?.trim() || null,
      city: dto.city?.trim() || null,
      country: dto.country?.trim() || null,
      birthDate: dto.birthDate || null,
      nationality: dto.nationality?.trim() || null,
      linkedIn: dto.linkedIn?.trim() || null,
      website: dto.website?.trim() || null,
      summary: dto.summary?.trim() || null,
      education: dto.education ?? [],
      experience: dto.experience ?? [],
      skills: dto.skills ?? [],
      languages: dto.languages ?? [],
      rawText: dto.rawText || null,
      notes: dto.notes?.trim() || null,
      status: dto.status ?? CandidateStatus.NEW,
      active: true,
    });
    const saved = await this.candidates.save(row);
    return this.toDto(saved);
  }

  async update(user: AuthUser, shopId: string, id: string, dto: UpdateCandidateDto) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.candidates.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Candidato no encontrado');

    if (dto.firstName !== undefined) row.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) row.lastName = dto.lastName.trim();
    if (dto.email !== undefined) row.email = dto.email?.trim() || null;
    if (dto.phone !== undefined) row.phone = dto.phone?.trim() || null;
    if (dto.documentId !== undefined) row.documentId = dto.documentId?.trim() || null;
    if (dto.address !== undefined) row.address = dto.address?.trim() || null;
    if (dto.city !== undefined) row.city = dto.city?.trim() || null;
    if (dto.country !== undefined) row.country = dto.country?.trim() || null;
    if (dto.birthDate !== undefined) row.birthDate = dto.birthDate || null;
    if (dto.nationality !== undefined) row.nationality = dto.nationality?.trim() || null;
    if (dto.linkedIn !== undefined) row.linkedIn = dto.linkedIn?.trim() || null;
    if (dto.website !== undefined) row.website = dto.website?.trim() || null;
    if (dto.summary !== undefined) row.summary = dto.summary?.trim() || null;
    if (dto.education !== undefined) row.education = dto.education ?? [];
    if (dto.experience !== undefined) row.experience = dto.experience ?? [];
    if (dto.skills !== undefined) row.skills = dto.skills ?? [];
    if (dto.languages !== undefined) row.languages = dto.languages ?? [];
    if (dto.rawText !== undefined) row.rawText = dto.rawText || null;
    if (dto.notes !== undefined) row.notes = dto.notes?.trim() || null;
    if (dto.status !== undefined) row.status = dto.status;

    const saved = await this.candidates.save(row);
    return this.toDto(saved);
  }

  async remove(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    const row = await this.candidates.findOne({ where: { id, shopId } });
    if (!row) throw new NotFoundException('Candidato no encontrado');
    await this.candidates.softRemove(row);
    return { ok: true };
  }
}
