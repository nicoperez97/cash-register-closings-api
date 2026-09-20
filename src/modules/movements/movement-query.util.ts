import { SelectQueryBuilder } from 'typeorm';
import { Movement } from '../../entities/movement.entity';

/**
 * Un movimiento generado por un cierre borrado no cuenta en el libro ni en saldos.
 * TypeORM, al hacer leftJoin de `closing`, ya filtra `deletedAt IS NULL` en el JOIN:
 * si el cierre está borrado, `liveClosing.id` queda NULL.
 */
export function excludeDeletedClosingMovements<T extends Movement>(
  qb: SelectQueryBuilder<T>,
  alias = 'm',
  joinAlias = 'liveClosing',
): SelectQueryBuilder<T> {
  qb.leftJoin(`${alias}.closing`, joinAlias);
  qb.andWhere(`(${alias}.closingId IS NULL OR ${joinAlias}.id IS NOT NULL)`);
  return qb;
}

export function isLiveClosingMovement(m: {
  closingId?: string | null;
  closing?: { id?: string } | null;
}): boolean {
  return !m.closingId || !!m.closing?.id;
}
