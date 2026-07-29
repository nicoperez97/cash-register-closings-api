import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesSystem } from '../entities/sales-system.entity';

export const RESTOSOFT_CODE = 'RESTOSOFT';
export const RESTOSOFT_PARSER_KEY = 'restosoft';

/** Defaults Restosoft: código FormaDePago → campo CashClosing. */
export const DEFAULT_RESTOSOFT_PAYMENT_MAP: Record<string, string> = {
  CE: 'cash',
  EF: 'cash',
  EFECTIVO: 'cash',
  TC: 'card',
  TD: 'card',
  PVS: 'card',
  TARJETA: 'card',
  MP: 'mercadoPago',
  MERCADOPAGO: 'mercadoPago',
  DELIVERY: 'delivery',
  PEDIDOSYA: 'delivery',
  RAPPI: 'delivery',
  TR: 'transfer',
  TRANSF: 'transfer',
  TRANSFERENCIA: 'transfer',
  DNI: 'accountDni',
  CUENTADNI: 'accountDni',
};

@Injectable()
export class SalesSystemsSeedService implements OnModuleInit {
  constructor(
    @InjectRepository(SalesSystem)
    private readonly systems: Repository<SalesSystem>,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureRestosoft();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SalesSystemsSeed] failed:', err);
    }
  }

  async ensureRestosoft(): Promise<SalesSystem> {
    let row = await this.systems.findOne({ where: { code: RESTOSOFT_CODE } });
    if (!row) {
      row = await this.systems.save(
        this.systems.create({
          code: RESTOSOFT_CODE,
          name: 'Restosoft',
          parserKey: RESTOSOFT_PARSER_KEY,
          active: true,
        }),
      );
    }
    return row;
  }

  async listActive(): Promise<SalesSystem[]> {
    return this.systems.find({
      where: { active: true },
      order: { name: 'ASC' },
    });
  }
}
