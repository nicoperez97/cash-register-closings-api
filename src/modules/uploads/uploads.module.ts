import { Module } from '@nestjs/common';
import { UploadsPurgeScheduler } from './uploads-purge.scheduler';
import { UploadsPurgeService } from './uploads-purge.service';

@Module({
  providers: [UploadsPurgeService, UploadsPurgeScheduler],
})
export class UploadsModule {}
