import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from '../modules/auth/jwt.strategy';
import { AuthService } from '../modules/auth/auth.service';
import { assertDemoReadOnly } from './guards';
import { clientIpFromForwarded } from './public-abuse.guard';
import { servableMime } from './uploads';

describe('JwtStrategy.validate', () => {
  const buildAuthUser = jest.fn(async (id: string) => ({ id }));
  const strategy = new JwtStrategy(
    { get: () => 'test-secret' } as unknown as ConfigService,
    { buildAuthUser } as unknown as AuthService,
  );

  beforeEach(() => buildAuthUser.mockClear());

  it('rechaza el token de mozo (sin sub) sin buscar usuario', async () => {
    await expect(
      strategy.validate({ typ: 'waiter', shopId: 's', employeeId: 'e' } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(buildAuthUser).not.toHaveBeenCalled();
  });

  it('rechaza tokens tipados aunque traigan sub', async () => {
    await expect(strategy.validate({ typ: 'dine_in', sub: 'u1' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza sub vacío o no string', async () => {
    await expect(strategy.validate({ sub: '' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate({ sub: 42 })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(buildAuthUser).not.toHaveBeenCalled();
  });

  it('acepta la sesión de usuario', async () => {
    await expect(strategy.validate({ sub: 'u1', isDemo: true })).resolves.toEqual({
      id: 'u1',
      isDemo: true,
    });
  });
});

describe('assertDemoReadOnly', () => {
  it('deja leer a la demo', () => {
    expect(() => assertDemoReadOnly({ method: 'GET', user: { isDemo: true } })).not.toThrow();
  });

  it('bloquea mutaciones de la demo', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(() => assertDemoReadOnly({ method, user: { isDemo: true } })).toThrow(
        ForbiddenException,
      );
    }
  });

  it('no afecta a usuarios normales', () => {
    expect(() => assertDemoReadOnly({ method: 'POST', user: { isDemo: false } })).not.toThrow();
    expect(() => assertDemoReadOnly({ method: 'POST' })).not.toThrow();
  });
});

describe('clientIpFromForwarded', () => {
  it('ignora lo que el cliente inventa a la izquierda (CloudFront -> nginx)', () => {
    // cliente manda "1.1.1.1", CloudFront agrega la IP real, nginx agrega la de CloudFront
    expect(clientIpFromForwarded('1.1.1.1, 200.0.0.5, 13.32.0.1', 1, 'x')).toBe('200.0.0.5');
  });

  it('sin header usa la IP del socket', () => {
    expect(clientIpFromForwarded('', 1, '10.0.0.2')).toBe('10.0.0.2');
  });

  it('sin proxies delante de nginx toma el último', () => {
    expect(clientIpFromForwarded('1.1.1.1, 200.0.0.5', 0, 'x')).toBe('200.0.0.5');
  });

  it('cadena más corta que los hops: toma el primero', () => {
    expect(clientIpFromForwarded('200.0.0.5', 1, 'x')).toBe('200.0.0.5');
  });
});

describe('servableMime', () => {
  it('deja pasar PDF e imágenes', () => {
    expect(servableMime('application/pdf')).toBe('application/pdf');
    expect(servableMime('IMAGE/PNG')).toBe('image/png');
  });

  it('degrada HTML, SVG y vacíos a octet-stream', () => {
    expect(servableMime('text/html')).toBe('application/octet-stream');
    expect(servableMime('text/html; charset=utf-8')).toBe('application/octet-stream');
    expect(servableMime('image/svg+xml')).toBe('application/octet-stream');
    expect(servableMime(null)).toBe('application/octet-stream');
  });
});
