import { Global, Module } from '@nestjs/common';
import { GeminiDocumentService } from './gemini-document.service';
import { GroqDocumentService } from './groq-document.service';

@Global()
@Module({
  providers: [GroqDocumentService, GeminiDocumentService],
  exports: [GeminiDocumentService, GroqDocumentService],
})
export class AiModule {}
