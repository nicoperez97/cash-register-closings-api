import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators';

/** Para monitores de uptime: 200 si la API responde y llega a MySQL. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DataSource) {}

  @Public()
  @Get()
  async check() {
    const started = Date.now();
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ ok: false, db: 'down' });
    }
    return { ok: true, db: 'up', dbMs: Date.now() - started, uptimeS: Math.round(process.uptime()) };
  }
}
