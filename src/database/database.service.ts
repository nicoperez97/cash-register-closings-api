import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';

@Injectable()
export class DatabaseService implements TypeOrmOptionsFactory {
  constructor(private readonly config: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const db = this.config.get('database');
    return {
      type: 'mysql',
      host: db.host,
      port: db.port,
      username: db.username,
      password: db.password,
      database: db.database,
      autoLoadEntities: true,
      synchronize: db.synchronize,
      timezone: 'Z',
      // DATE como 'YYYY-MM-DD'. Si mysql2 lo infla a Date UTC, TypeORM lo pasa
      // a hora local y en AR/UY queda el día anterior.
      dateStrings: ['DATE'],
    };
  }
}
