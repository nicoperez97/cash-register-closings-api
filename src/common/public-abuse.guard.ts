import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './decorators';

type Bucket = { times: number[] };

/**
 * Protección de rutas @Public():
 * - rate limit por IP
 * - en POST/PUT/PATCH/DELETE de /public, el Origin/Referer tiene que ser el front
 */
@Injectable()
export class PublicAbuseGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private sweeps = 0;
  private readonly isProd: boolean;
  private readonly allowedOrigins: Set<string>;
  private readonly originStrict: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    this.isProd = (this.config.get<string>('environment') ?? 'development') === 'production';
    this.allowedOrigins = this.buildAllowedOrigins();
    this.originStrict = this.allowedOrigins.size > 0;
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isPublic) return true;

    const req = context.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      headers?: Record<string, string | string[] | undefined>;
      ip?: string;
      socket?: { remoteAddress?: string };
      body?: Record<string, unknown>;
      protocol?: string;
    }>();

    const method = String(req.method ?? 'GET').toUpperCase();
    if (method === 'OPTIONS' || method === 'HEAD') return true;

    const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
    if (path.startsWith('/api/docs') || path.startsWith('/ipad')) return true;

    const ip = this.clientIp(req);
    const mutating = method !== 'GET';
    const isPublicApi = path.includes('/public/');
    const isLogin = path.endsWith('/auth/login') && method === 'POST';
    const isReserve =
      isPublicApi && method === 'POST' && path.includes('/reservation-requests');

    if (mutating && isPublicApi) {
      this.assertAllowedOrigin(req);
    }

    if (isLogin) {
      this.hit(`login:${ip}`, 8, 60_000, 'Demasiados intentos de ingreso. Probá en un minuto.');
    } else if (isReserve) {
      this.hit(
        `reserve:${ip}`,
        6,
        10 * 60_000,
        'Demasiadas reservas desde esta red. Esperá un rato.',
      );
      const email = String(req.body?.guestEmail ?? '')
        .trim()
        .toLowerCase();
      if (email) {
        this.hit(
          `reserve-mail:${email}`,
          4,
          60 * 60_000,
          'Ya mandamos varias solicitudes con este mail. Revisá tu correo.',
        );
      }
    } else if (isPublicApi && mutating) {
      this.hit(
        `pub-mut:${ip}:${this.pathKey(path)}`,
        30,
        60_000,
        'Demasiados pedidos. Esperá un momento.',
      );
    } else if (isPublicApi) {
      this.hit(
        `pub-get:${ip}`,
        120,
        60_000,
        'Demasiadas consultas. Esperá un momento.',
      );
    } else {
      this.hit(`pub:${ip}`, 40, 60_000, 'Demasiados pedidos. Esperá un momento.');
    }

    this.maybeSweep();
    return true;
  }

  private assertAllowedOrigin(req: {
    headers?: Record<string, string | string[] | undefined>;
    protocol?: string;
  }): void {
    if (!this.originStrict) return;
    const origin = this.requestOrigin(req);
    if (!origin) {
      if (this.isProd) {
        throw new HttpException('Origen no permitido', HttpStatus.FORBIDDEN);
      }
      return;
    }
    const normalized = this.normalizeOrigin(origin);
    if (this.allowedOrigins.has(normalized)) return;
    const host = this.header(req, 'host').split(',')[0]?.trim();
    if (host) {
      const proto = this.header(req, 'x-forwarded-proto') || 'https';
      const sameHost = this.normalizeOrigin(`${proto.split(',')[0].trim()}://${host}`);
      if (sameHost && sameHost === normalized) return;
    }
    throw new HttpException('Origen no permitido', HttpStatus.FORBIDDEN);
  }

  private requestOrigin(req: {
    headers?: Record<string, string | string[] | undefined>;
  }): string | null {
    const origin = this.header(req, 'origin');
    if (origin) return origin;
    const referer = this.header(req, 'referer');
    if (!referer) return null;
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }

  private header(
    req: { headers?: Record<string, string | string[] | undefined> },
    name: string,
  ): string {
    const raw = req.headers?.[name];
    return String(Array.isArray(raw) ? raw[0] : raw ?? '').trim();
  }

  private clientIp(req: {
    headers?: Record<string, string | string[] | undefined>;
    ip?: string;
    socket?: { remoteAddress?: string };
  }): string {
    const forwarded = this.header(req, 'x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first.slice(0, 64);
    }
    const real = this.header(req, 'x-real-ip');
    if (real) return real.slice(0, 64);
    return String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 64);
  }

  private hit(key: string, max: number, windowMs: number, message: string): void {
    const now = Date.now();
    const from = now - windowMs;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { times: [] };
      this.buckets.set(key, bucket);
    }
    bucket.times = bucket.times.filter((t) => t > from);
    if (bucket.times.length >= max) {
      throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }
    bucket.times.push(now);
  }

  private pathKey(path: string): string {
    return path.replace(/\/[0-9a-fA-F-]{8,}\b/g, '/:id').slice(0, 120);
  }

  private maybeSweep(): void {
    this.sweeps += 1;
    if (this.sweeps % 200 !== 0) return;
    const cutoff = Date.now() - 60 * 60_000;
    for (const [key, bucket] of this.buckets) {
      bucket.times = bucket.times.filter((t) => t > cutoff);
      if (!bucket.times.length) this.buckets.delete(key);
    }
  }

  private buildAllowedOrigins(): Set<string> {
    const set = new Set<string>();
    const cors = this.config.get('cors.origin');
    if (cors === true) return set;
    const push = (raw?: string | null) => {
      const v = this.normalizeOrigin(String(raw ?? ''));
      if (v) set.add(v);
    };
    if (typeof cors === 'string') push(cors);
    if (Array.isArray(cors)) cors.forEach((o) => push(String(o)));
    push(this.config.get<string>('publicAppOrigin'));
    if (!this.isProd) {
      push('http://localhost:4200');
      push('http://127.0.0.1:4200');
      push('http://localhost:3000');
    }
    return set;
  }

  private normalizeOrigin(raw: string): string {
    const v = raw.trim().replace(/\/+$/, '');
    if (!v || v === '*') return '';
    try {
      if (/^https?:\/\//i.test(v)) return new URL(v).origin;
    } catch {
      return '';
    }
    return v;
  }
}
