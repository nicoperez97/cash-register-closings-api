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

  app.enableCors(config.get('cors'));
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
    express.get('/ipad', (_req: unknown, res: { redirect: (code: number, url: string) => void }) => {
      res.redirect(302, '/ipad/');
    });
    app.useStaticAssets(legacyDir, { prefix: '/ipad/' });
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
    console.log(`iPad legacy http://localhost:${port}/ipad/`);
  }
}

void bootstrap();
