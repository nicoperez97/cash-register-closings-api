import { BadRequestException, Injectable } from '@nestjs/common';
import { SalesSystemParser } from './sales-system-parser';
import { RestosoftParser } from './restosoft.parser';
import { WemenuParser } from './wemenu.parser';

@Injectable()
export class SalesParserRegistry {
  private readonly parsers: Map<string, SalesSystemParser>;

  constructor() {
    const restosoft = new RestosoftParser();
    const wemenu = new WemenuParser();
    this.parsers = new Map<string, SalesSystemParser>([
      [restosoft.key, restosoft],
      [wemenu.key, wemenu],
    ]);
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
