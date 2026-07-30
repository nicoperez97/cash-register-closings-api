import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesSystem } from '../entities/sales-system.entity';

export const RESTOSOFT_CODE = 'RESTOSOFT';
export const RESTOSOFT_PARSER_KEY = 'restosoft';

export const WEMENU_CODE = 'WEMENU';
export const WEMENU_PARSER_KEY = 'wemenu';

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

/**
 * Defaults WeMenu: labels de forma de pago → campo CashClosing.
 * El PDF dashboard actual solo aporta TOTAL (→ other); el resto queda listo
 * para un export tabular futuro.
 */
export const DEFAULT_WEMENU_PAYMENT_MAP: Record<string, string> = {
  TOTAL: 'other',
  EFECTIVO: 'cash',
  ESTUDIANTEEFECTIVO: 'cash',
  TRANSFERENCIA: 'transfer',
  TRANSF: 'transfer',
  MERCADOPAGO: 'mercadoPago',
  CUENTADNI: 'accountDni',
  TARJETADEBITO: 'card',
  TARJETACREDITO: 'card',
  TARJETA: 'card',
  UALABIS: 'other',
  UALA: 'other',
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
      await this.ensureWeMenu();
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

  async ensureWeMenu(): Promise<SalesSystem> {
    let row = await this.systems.findOne({ where: { code: WEMENU_CODE } });
    if (!row) {
      row = await this.systems.save(
        this.systems.create({
          code: WEMENU_CODE,
          name: 'WeMenu',
          parserKey: WEMENU_PARSER_KEY,
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
