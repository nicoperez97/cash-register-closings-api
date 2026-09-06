import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseUploadsPurgeCron,
  parseUploadsPurgeTz,
  parseUploadsRetentionDays,
  uploadRetentionCutoff,
} from '../../common/upload-retention';
import { purgeExpiredDocumentUploads } from '../../common/uploads';

@Injectable()
export class UploadsPurgeService {
  private readonly logger = new Logger(UploadsPurgeService.name);

  constructor(private readonly config: ConfigService) {}

  retentionDays(): number {
    const raw = this.config.get<number>('uploads.retentionDays');
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
      return Math.floor(raw);
    }
    return parseUploadsRetentionDays(process.env.UPLOADS_RETENTION_DAYS);
  }

  cronExpression(): string {
    return parseUploadsPurgeCron(
      this.config.get<string>('uploads.purgeCron') ?? process.env.UPLOADS_PURGE_CRON,
    );
  }

  timeZone(): string {
    return parseUploadsPurgeTz(
      this.config.get<string>('uploads.purgeTz') ?? process.env.UPLOADS_PURGE_TZ,
    );
  }

  /** Borra documentos vencidos. 0 = no hace nada. */
  run(now = new Date()): number {
    const retentionDays = this.retentionDays();
    if (retentionDays <= 0) {
      this.logger.debug('Purga de uploads desactivada (retentionDays=0)');
      return 0;
    }
    const cutoff = uploadRetentionCutoff(now, retentionDays);
    const removed = purgeExpiredDocumentUploads(cutoff);
    if (removed > 0) {
      this.logger.log(
        `Purga de uploads: ${removed} archivo(s) anteriores a ${cutoff.toISOString()}`,
      );
    } else {
      this.logger.debug(`Purga de uploads: nada que borrar (corte ${cutoff.toISOString()})`);
    }
    return removed;
  }
}
