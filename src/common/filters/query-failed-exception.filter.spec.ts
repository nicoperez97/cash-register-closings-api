import { ArgumentsHost } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { QueryFailedExceptionFilter } from './query-failed-exception.filter';

function makeHost(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

function makeError(code: string): QueryFailedError {
  const err = new QueryFailedError('INSERT ...', [], new Error('db') as never);
  (err as unknown as { driverError: { code: string } }).driverError = { code };
  return err;
}

describe('QueryFailedExceptionFilter', () => {
  const filter = new QueryFailedExceptionFilter();

  it('mapea ER_DUP_ENTRY a 409', () => {
    const { host, json, status } = makeHost();
    filter.catch(makeError('ER_DUP_ENTRY'), host);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, error: 'Conflict' }),
    );
  });

  it('mapea FK referenciada (ER_ROW_IS_REFERENCED_2) a 409', () => {
    const { host, json, status } = makeHost();
    filter.catch(makeError('ER_ROW_IS_REFERENCED_2'), host);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 }),
    );
  });

  it('mapea referencia inexistente (ER_NO_REFERENCED_ROW_2) a 400', () => {
    const { host, status } = makeHost();
    filter.catch(makeError('ER_NO_REFERENCED_ROW_2'), host);
    expect(status).toHaveBeenCalledWith(400);
  });

  it('no filtra SQL crudo al cliente en errores desconocidos (500 genérico)', () => {
    const { host, json, status } = makeHost();
    filter.catch(makeError('ER_SOMETHING_WEIRD'), host);
    expect(status).toHaveBeenCalledWith(500);
    const payload = json.mock.calls[0][0];
    expect(payload.message).not.toContain('INSERT');
    expect(payload.statusCode).toBe(500);
  });
});
