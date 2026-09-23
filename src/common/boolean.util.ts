import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { isEntityActive } from './active.util';

/**
 * Normaliza inputs típicos de clientes/MySQL a boolean real para ValidationPipe.
 * Deja pasar undefined/null/'' para que @IsOptional() funcione.
 * Valores no reconocidos se dejan igual para que @IsBoolean() falle con mensaje claro.
 */
export function coerceBooleanInput(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return value;
  if (value === true || value === false) return value;
  if (value === 1 || value === '1' || value === 'true' || value === 'TRUE') return true;
  if (value === 0 || value === '0' || value === 'false' || value === 'FALSE') return false;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === '1' || s === 'true') return true;
    if (s === '0' || s === 'false') return false;
  }
  if (Buffer.isBuffer(value)) return isEntityActive(value);
  return value;
}

/** @Transform que convierte 0/1/"true" → boolean antes de @IsBoolean(). */
export function ToBoolean(): PropertyDecorator {
  return Transform(({ value }) => coerceBooleanInput(value));
}

/** Atajo: opcional + coerce + IsBoolean. */
export function OptionalBoolean(): PropertyDecorator {
  return applyDecorators(IsOptional(), ToBoolean(), IsBoolean());
}

/** Atajo: coerce + IsBoolean (requerido). */
export function RequiredBoolean(): PropertyDecorator {
  return applyDecorators(ToBoolean(), IsBoolean());
}
