/**
 * TypeORM: si un ManyToOne está hidratado, `save()` puede pisar el `*Id`
 * recién asignado con el id de la entidad relacionada vieja.
 * Llamar antes de `save` cuando se mutaron FKs.
 */
export function detachRelations<T extends object>(
  entity: T,
  keys: readonly (keyof T | string)[],
): T {
  const row = entity as Record<string, unknown>;
  for (const key of keys) {
    delete row[String(key)];
  }
  return entity;
}
