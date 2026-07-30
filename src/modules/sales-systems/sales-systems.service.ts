import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesSystem } from '../../entities/sales-system.entity';
import { Shop } from '../../entities/shop.entity';
import { SalesSystemsSeedService } from '../../common/sales-systems-seed.service';
import { SalesParserRegistry } from '../sales-reports/parsers/parser-registry';

export class UpsertSalesSystemDto {
  code: string;
  name: string;
  parserKey: string;
  active?: boolean;
}

@Injectable()
export class SalesSystemsService {
  constructor(
    @InjectRepository(SalesSystem)
    private readonly systems: Repository<SalesSystem>,
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    private readonly seed: SalesSystemsSeedService,
    private readonly parsers: SalesParserRegistry,
  ) {}

  private toDto(s: SalesSystem) {
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      parserKey: s.parserKey,
      active: !!s.active,
      parserAvailable: this.parsers.has(s.parserKey),
    };
  }

  async listActive() {
    await this.seed.ensureRestosoft();
    await this.seed.ensureWeMenu();
    const rows = await this.seed.listActive();
    return rows.map((s) => this.toDto(s));
  }

  async listAll() {
    await this.seed.ensureRestosoft();
    await this.seed.ensureWeMenu();
    const rows = await this.systems.find({ order: { name: 'ASC' } });
    return rows.map((s) => this.toDto(s));
  }

  listParsers() {
    const labels: Record<string, string> = {
      restosoft: 'Restosoft',
      wemenu: 'WeMenu',
    };
    return this.parsers.keys().map((key) => ({
      key,
      label: labels[key] ?? key,
    }));
  }

  async create(dto: UpsertSalesSystemDto) {
    const code = dto.code.trim().toUpperCase().replace(/\s+/g, '_');
    if (!code) throw new BadRequestException('Código obligatorio');
    const clash = await this.systems.findOne({ where: { code } });
    if (clash) throw new BadRequestException('Ya existe un sistema con ese código');
    const parserKey = dto.parserKey.trim().toLowerCase();
    if (!this.parsers.has(parserKey)) {
      throw new BadRequestException(
        `Parser "${parserKey}" no registrado. Disponibles: ${this.parsers.keys().join(', ')}`,
      );
    }
    const row = await this.systems.save(
      this.systems.create({
        code,
        name: dto.name.trim(),
        parserKey,
        active: dto.active ?? true,
      }),
    );
    return this.toDto(row);
  }

  async update(id: string, dto: Partial<UpsertSalesSystemDto>) {
    const row = await this.systems.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Sistema no encontrado');
    if (dto.code !== undefined) {
      const code = dto.code.trim().toUpperCase().replace(/\s+/g, '_');
      const clash = await this.systems.findOne({ where: { code } });
      if (clash && clash.id !== id) {
        throw new BadRequestException('Ya existe un sistema con ese código');
      }
      row.code = code;
    }
    if (dto.name !== undefined) row.name = dto.name.trim();
    if (dto.parserKey !== undefined) {
      const parserKey = dto.parserKey.trim().toLowerCase();
      if (!this.parsers.has(parserKey)) {
        throw new BadRequestException(
          `Parser "${parserKey}" no registrado. Disponibles: ${this.parsers.keys().join(', ')}`,
        );
      }
      row.parserKey = parserKey;
    }
    if (dto.active !== undefined) row.active = dto.active;
    await this.systems.save(row);
    return this.toDto(row);
  }

  async remove(id: string) {
    const row = await this.systems.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Sistema no encontrado');
    const inUse = await this.shops.count({ where: { salesSystemId: id, active: true } });
    if (inUse > 0) {
      throw new BadRequestException(
        `No se puede eliminar: ${inUse} local(es) lo tienen asignado. Desasignalo primero.`,
      );
    }
    await this.systems.softRemove(row);
    return { ok: true };
  }
}
