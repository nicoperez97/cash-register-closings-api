import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  const isProd = (config.get<string>('environment') ?? 'development') === 'production';
  if (isProd) {
    app.set('trust proxy', 1);
  }
  app.enableCors(config.get('cors'));
  app.use(
    (
      _req: unknown,
      res: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('X-DNS-Prefetch-Control', 'off');
      next();
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api/v1');

  // Cliente ES5 para iPad iOS 9.3.x — mismo host que la API (sin CORS)
  const legacyDir = join(__dirname, '..', 'legacy-ipad');
  if (existsSync(legacyDir)) {
    const express = app.getHttpAdapter().getInstance();
    const sendLegacyBoard = (file: string) =>
      (
        _req: unknown,
        res: { sendFile: (path: string) => void },
      ) => {
        res.sendFile(join(legacyDir, file));
      };
    const redirectLegacyIndex = (
      req: { url?: string },
      res: { redirect: (code: number, url: string) => void },
      next: () => void,
    ) => {
      const url = String(req.url || '');
      if (
        url === '/legacy' ||
        url.startsWith('/legacy?') ||
        url === '/ipad' ||
        url.startsWith('/ipad?')
      ) {
        res.redirect(302, '/legacy/index.html');
        return;
      }
      next();
    };
    express.get('/legacy', redirectLegacyIndex);
    express.get('/legacy/', (_req: unknown, res: { redirect: (code: number, url: string) => void }) => {
      res.redirect(302, '/legacy/index.html');
    });
    express.get('/ipad', redirectLegacyIndex);
    express.get('/ipad/', (_req: unknown, res: { redirect: (code: number, url: string) => void }) => {
      res.redirect(302, '/legacy/index.html');
    });
    express.get('/legacy/r/:slug', sendLegacyBoard('board-r.html'));
    express.get('/legacy/r/:slug/', sendLegacyBoard('board-r.html'));
    express.get('/legacy/w/:slug', sendLegacyBoard('board-w.html'));
    express.get('/legacy/w/:slug/', sendLegacyBoard('board-w.html'));
    express.get('/ipad/r/:slug', sendLegacyBoard('board-r.html'));
    express.get('/ipad/r/:slug/', sendLegacyBoard('board-r.html'));
    express.get('/ipad/w/:slug', sendLegacyBoard('board-w.html'));
    express.get('/ipad/w/:slug/', sendLegacyBoard('board-w.html'));
    app.useStaticAssets(legacyDir, { prefix: '/legacy/', index: 'index.html' });
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Cash Register Closings API')
    .setDescription('API de cierres de caja multi-local')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get<number>('api.port') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`CRC API http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Swagger http://localhost:${port}/api/docs`);
  if (existsSync(legacyDir)) {
    // eslint-disable-next-line no-console
    console.log(`Legacy ES5 http://localhost:${port}/legacy/index.html`);
  }
}

void bootstrap();
