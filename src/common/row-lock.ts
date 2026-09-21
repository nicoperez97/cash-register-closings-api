import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';

/** ER_DUP_ENTRY de MySQL (índice único). */
export function isMysqlDuplicateKey(err: unknown): boolean {
  const e = err as {
    code?: string;
    errno?: number;
    driverError?: { errno?: number; code?: string };
  };
  return (
    e?.code === 'ER_DUP_ENTRY' ||
    e?.errno === 1062 ||
    e?.driverError?.errno === 1062 ||
    e?.driverError?.code === 'ER_DUP_ENTRY'
  );
}

export async function lockEntity<Entity extends ObjectLiteral>(
  manager: EntityManager,
  entity: EntityTarget<Entity>,
  alias: string,
  where: string,
  params: Record<string, unknown>,
): Promise<Entity | null> {
  return manager
    .getRepository(entity)
    .createQueryBuilder(alias)
    .setLock('pessimistic_write')
    .where(where, params)
    .getOne();
}
