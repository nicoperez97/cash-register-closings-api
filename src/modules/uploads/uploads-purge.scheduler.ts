import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { UploadsPurgeService } from './uploads-purge.service';

@Injectable()
export class UploadsPurgeScheduler implements OnModuleInit {
  private readonly logger = new Logger(UploadsPurgeScheduler.name);

  constructor(
    private readonly purge: UploadsPurgeService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const days = this.purge.retentionDays();
    if (days <= 0) {
      this.logger.log('Scheduler de purga de uploads desactivado (UPLOADS_RETENTION_DAYS=0)');
      return;
    }
    const cron = this.purge.cronExpression();
    const timeZone = this.purge.timeZone();
    const job = new CronJob(
      cron,
      () => {
        try {
          this.purge.run();
        } catch (err) {
          this.logger.error(
            'Falló la purga de uploads',
            err instanceof Error ? err.stack : String(err),
          );
        }
      },
      null,
      false,
      timeZone,
    );
    this.schedulerRegistry.addCronJob('uploads-document-purge', job);
    job.start();
    this.logger.log(`Purga de uploads programada: cron="${cron}" tz="${timeZone}" días=${days}`);
  }
}
