import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';

/** Mensajes claros para fallos de upload (busboy/multer). */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let message = 'No se pudo subir el archivo';
    if (exception.code === 'LIMIT_FILE_SIZE') {
      message = 'El archivo es demasiado grande';
    } else if (exception.message?.includes('Unexpected end of form')) {
      message =
        'La subida se cortó. Probá de nuevo con el archivo (en el celular, volvé a elegirlo).';
    } else if (exception.message) {
      message = exception.message;
    }
    res.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message,
      error: 'Bad Request',
    });
  }
}
