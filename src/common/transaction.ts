import { ConflictException } from '@nestjs/common';
import { EntityManager, ObjectLiteral, Repository } from 'typeorm';

/**
 * Aislamiento de las transacciones de plata. READ COMMITTED y no el REPEATABLE READ
 * por defecto de InnoDB: varios pasos (seed de cuentas, cuenta socio nueva) escriben
 * con su propia conexión en medio del flujo, y con un snapshot fijo la transacción no
 * vería esas filas. La atomicidad y los FOR UPDATE funcionan igual.
 */
export const MONEY_TX_ISOLATION = 'READ COMMITTED' as const;

/**
 * Repo del mismo tipo que `repo`, pero ligado a `manager` si estamos dentro de una
 * transacción. Así un servicio puede ofrecer `metodo(..., manager?)` y escribir
 * con la misma conexión que el llamador sin duplicar código.
 */
export function repoFor<Entity extends ObjectLiteral>(
  repo: Repository<Entity>,
  manager?: EntityManager | null,
): Repository<Entity> {
  return manager ? manager.getRepository<Entity>(repo.target) : repo;
}

/**
 * Corre `fn` en una transacción de plata. Si `outer` ya está en una transacción
 * activa la reusa (el llamador decide cuándo se confirma todo).
 */
export async function moneyTransaction<T>(
  manager: EntityManager,
  fn: (em: EntityManager) => Promise<T>,
  outer?: EntityManager | null,
): Promise<T> {
  if (outer?.queryRunner?.isTransactionActive) return fn(outer);
  return manager.transaction(MONEY_TX_ISOLATION, fn);
}

/**
 * Serializa una operación por clave (p. ej. «división de socios del local X») con
 * GET_LOCK de MySQL y la corre en una transacción en esa misma conexión. El lock
 * se suelta recién después del COMMIT, así quien espera ve los datos ya escritos.
 * Útil cuando no hay una fila natural para bloquear con FOR UPDATE.
 */
export async function withAdvisoryLock<T>(
  manager: EntityManager,
  key: string,
  fn: (em: EntityManager) => Promise<T>,
  opts?: { timeoutSec?: number; busyMessage?: string },
): Promise<T> {
  const lockKey = key.slice(0, 64);
  const qr = manager.connection.createQueryRunner();
  await qr.connect();
  try {
    const rows: Array<{ ok: number | string | null }> = await qr.query(
      'SELECT GET_LOCK(?, ?) AS ok',
      [lockKey, opts?.timeoutSec ?? 10],
    );
    if (Number(rows?.[0]?.ok) !== 1) {
      throw new ConflictException(
        opts?.busyMessage ?? 'Hay otra operación igual en curso. Probá de nuevo en unos segundos.',
      );
    }
    try {
      return await qr.manager.transaction(MONEY_TX_ISOLATION, fn);
    } finally {
      await qr.query('SELECT RELEASE_LOCK(?)', [lockKey]).catch(() => undefined);
    }
  } finally {
    await qr.release();
  }
}
