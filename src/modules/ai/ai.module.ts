import { Global, Module } from '@nestjs/common';
import { GeminiDocumentService } from './gemini-document.service';

@Global()
@Module({
  providers: [GeminiDocumentService],
  exports: [GeminiDocumentService],
})
export class AiModule {}
