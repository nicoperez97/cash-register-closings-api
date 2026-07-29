import { BadRequestException, Injectable } from '@nestjs/common';
import { SalesSystemParser } from './sales-system-parser';
import { RestosoftParser } from './restosoft.parser';

@Injectable()
export class SalesParserRegistry {
  private readonly parsers: Map<string, SalesSystemParser>;

  constructor() {
    const restosoft = new RestosoftParser();
    this.parsers = new Map([[restosoft.key, restosoft]]);
  }

  get(parserKey: string): SalesSystemParser {
    const p = this.parsers.get(parserKey);
    if (!p) {
      throw new BadRequestException(`No hay parser registrado para "${parserKey}"`);
    }
    return p;
  }

  has(parserKey: string): boolean {
    return this.parsers.has(parserKey);
  }

  keys(): string[] {
    return [...this.parsers.keys()];
  }

  detect(file: Express.Multer.File): SalesSystemParser | null {
    for (const p of this.parsers.values()) {
      if (p.canParse(file)) return p;
    }
    return null;
  }
}
