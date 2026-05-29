import { NestFactory } from '@nestjs/core';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppModule } from './app.module';

function shouldServeFrontend(req: Request) {
  const excludedPrefixes = ['/api', '/oauth2', '/.well-known', '/uploads'];
  const isBackendRoute = excludedPrefixes.some(
    (prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`),
  );

  return !isBackendRoute && Boolean(req.accepts('html'));
}

function configureFrontendStatic(app: INestApplication, distDir: string) {
  const indexHtml = join(distDir, 'index.html');
  if (!existsSync(indexHtml)) {
    return;
  }

  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.use(express.static(distDir, { index: false }));
  expressApp.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
    if (!shouldServeFrontend(req)) {
      return next();
    }

    return res.sendFile(indexHtml);
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') ?? 3000;
  const frontendDistDir = resolve(
    configService.get<string>('FRONTEND_DIST_DIR') ?? join(process.cwd(), 'public'),
  );

  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  app.enableCors({
    origin: true,
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  configureFrontendStatic(app, frontendDistDir);
  await app.init();
  await app.listen(port);
}
bootstrap();
