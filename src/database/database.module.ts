import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigModule } from '../config/config.module';
import { DatabaseService } from './database.service';

/**
 * Uniques viejos que también sirven de índice a una FK.
 * TypeORM quiere dropearlos al sumar shiftId; MySQL no deja si no hay otro índice
 * en la columna de la FK. Preparamos índices + unique nuevo antes del synchronize.
 */
async function ensureFkIndexesBeforeSync(ds: DataSource) {
  const stmts = [
    `CREATE INDEX IDX_attendance_days_employeeId ON attendance_days (employeeId)`,
    // payroll_lines: unique viejo (periodId, employeeId) → FKs necesitan índices propios
    `CREATE INDEX IDX_payroll_lines_periodId ON payroll_lines (periodId)`,
    `CREATE INDEX IDX_payroll_lines_employeeId ON payroll_lines (employeeId)`,
  ];
  for (const sql of stmts) {
    try {
      await ds.query(sql);
    } catch {
      // ya existe o la tabla todavía no está
    }
  }

  try {
    await ds.query(`
      ALTER TABLE payroll_lines
        ADD COLUMN shiftId VARCHAR(36) NOT NULL DEFAULT ''
    `);
  } catch {
    // ya existe
  }

  // Dropear unique (periodId, employeeId) sea cual sea su nombre hash
  try {
    const rows: Array<{ INDEX_NAME: string }> = await ds.query(`
      SELECT DISTINCT INDEX_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'payroll_lines'
        AND NON_UNIQUE = 0
        AND INDEX_NAME <> 'PRIMARY'
        AND INDEX_NAME <> 'uq_payroll_lines_period_emp_shift'
    `);
    for (const { INDEX_NAME: name } of rows) {
      const cols: Array<{ COLUMN_NAME: string }> = await ds.query(
        `
        SELECT COLUMN_NAME
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'payroll_lines'
          AND INDEX_NAME = ?
        ORDER BY SEQ_IN_INDEX
        `,
        [name],
      );
      const colNames = cols.map((c) => c.COLUMN_NAME);
      if (
        colNames.length === 2 &&
        colNames[0] === 'periodId' &&
        colNames[1] === 'employeeId'
      ) {
        try {
          await ds.query(`ALTER TABLE payroll_lines DROP INDEX \`${name}\``);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    await ds.query(`
      ALTER TABLE payroll_lines
        ADD UNIQUE INDEX uq_payroll_lines_period_emp_shift (periodId, employeeId, shiftId)
    `);
  } catch {
    // ya existe
  }
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useClass: DatabaseService,
      dataSourceFactory: async (options) => {
        if (!options?.type) {
          throw new Error('Falta la configuración de TypeORM');
        }
        const sync = !!options.synchronize;
        const ds = new DataSource({ ...options, synchronize: false });
        await ds.initialize();
        await ensureFkIndexesBeforeSync(ds);
        if (sync) await ds.synchronize();
        return ds;
      },
    }),
  ],
})
export class DatabaseModule {}
