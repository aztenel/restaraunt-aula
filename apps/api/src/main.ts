import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { Config, loadEnvFileIfPresent } from './shared/infrastructure/config/config';
import { setupSwagger } from './shared/infrastructure/http/swagger';
import { buildValidationPipe } from './shared/infrastructure/http/validation';
import { initSentry } from './shared/infrastructure/logging/sentry';

export const API_PREFIX = 'api/v1';

export function configureHttpApp(app: NestExpressApplication, config: Config): void {
  app.setGlobalPrefix(API_PREFIX);
  app.set('trust proxy', config.app.trustProxy ? 1 : false);
  app.use(
    helmet({
      // HSTS: HTTPS с редиректом делает reverse proxy, HSTS дублируем и на API.
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false },
      contentSecurityPolicy: false,
    }),
  );
  app.use(cookieParser());
  app.enableCors({ origin: config.app.corsOrigins, credentials: true });
  app.useGlobalPipes(buildValidationPipe());
  app.enableShutdownHooks();
}

async function bootstrap(): Promise<void> {
  loadEnvFileIfPresent();
  const config = new Config();
  initSentry(config, 'api');
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureHttpApp(app, config);
  if (config.app.swaggerEnabled) setupSwagger(app, config.app.release);
  await app.listen(config.app.port);
}

if (require.main === module) {
  void bootstrap();
}
