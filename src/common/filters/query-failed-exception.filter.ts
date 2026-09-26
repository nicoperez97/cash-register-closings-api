import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';

type DriverError = { code?: string; errno?: number; sqlMessage?: string };

/**
 * Traduce errores de base de datos (TypeORM/MySQL) a respuestas de negocio en
 * español, sin filtrar SQL ni detalles internos al cliente. Solo captura
 * QueryFailedError: las HttpException y demás siguen con el manejo por defecto.
 */
@Catch(QueryFailedError)
export class QueryFailedExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('DbError');

  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const driver = (exception as unknown as { driverError?: DriverError })
      .driverError;
    const code = driver?.code;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'No se pudo completar la operación por un error de datos';
    let error = 'Internal Server Error';

    switch (code) {
      case 'ER_DUP_ENTRY':
        status = HttpStatus.CONFLICT;
        message = 'Ya existe un registro con esos datos';
        error = 'Conflict';
        break;
      case 'ER_ROW_IS_REFERENCED':
      case 'ER_ROW_IS_REFERENCED_2':
        status = HttpStatus.CONFLICT;
        message = 'No se puede eliminar: hay datos relacionados que dependen de este registro';
        error = 'Conflict';
        break;
      case 'ER_NO_REFERENCED_ROW':
      case 'ER_NO_REFERENCED_ROW_2':
        status = HttpStatus.BAD_REQUEST;
        message = 'Referencia inválida: el registro relacionado no existe';
        error = 'Bad Request';
        break;
      case 'ER_BAD_NULL_ERROR':
        status = HttpStatus.BAD_REQUEST;
        message = 'Falta un dato obligatorio';
        error = 'Bad Request';
        break;
      case 'ER_DATA_TOO_LONG':
        status = HttpStatus.BAD_REQUEST;
        message = 'Uno de los valores es demasiado largo';
        error = 'Bad Request';
        break;
      default:
        break;
    }

    // Siempre logueamos el error real del lado del servidor para operar.
    this.logger.error(
      `QueryFailedError${code ? ` [${code}]` : ''}: ${exception.message}`,
    );

    res.status(status).json({ statusCode: status, message, error });
  }
}
