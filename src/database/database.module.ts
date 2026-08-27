import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigModule } from '../config/config.module';
import { DatabaseService } from './database.service';

/**
 * El unique viejo (employeeId, date) también sirve de índice para la FK de empleado.
 * TypeORM quiere dropearlo al pasar a (employeeId, date, shiftId); MySQL no deja
 * si no hay otro índice en employeeId. Lo creamos antes del synchronize.
 */
async function ensureAttendanceFkIndex(ds: DataSource) {
  try {
    await ds.query(`
      CREATE INDEX IDX_attendance_days_employeeId ON attendance_days (employeeId)
    `);
  } catch {
    // ya existe o la tabla todavía no está
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
        await ensureAttendanceFkIndex(ds);
        if (sync) await ds.synchronize();
        return ds;
      },
    }),
  ],
})
export class DatabaseModule {}
