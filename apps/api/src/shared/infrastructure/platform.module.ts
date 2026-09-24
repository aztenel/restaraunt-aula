import { Global, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Clock, SystemClock } from '../kernel/clock';
import { AuditLog } from './audit/audit-log';
import { Config } from './config/config';
import { SecretBox } from './crypto/secret-box';
import { DatabaseModule } from './database/database.module';
import { DocumentNumbering } from './database/numbering';
import { EventsModule } from './events/events.module';
import { HealthController } from './health/health.controller';
import { HttpMetricsInterceptor } from './health/http-metrics.interceptor';
import { MetricsService } from './health/metrics.service';
import { ApiExceptionFilter } from './http/exception.filter';
import { RequestContextMiddleware } from './http/request-context.middleware';
import { ExternalHttp, FetchTransport, HttpTransport } from './integrations/external-http';
import { IntegrationLog } from './integrations/integration-log';
import { PdfRenderer } from './pdf/pdf-renderer';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RateLimiter } from './rate-limit/rate-limiter';
import { RedisConnection } from './redis/redis';
import { IntegrationCatalog } from './settings/integration-catalog';
import { IntegrationSettings } from './settings/integration-settings';
import { createFileStorage, FileStorage } from './storage/file-storage';
import { FilesController } from './storage/files.controller';
import { XlsxBuilder } from './xlsx/xlsx-builder';

/**
 * Платформа: инфраструктура, общая для всех модулей (БД, outbox и очередь, аудит,
 * файлы, PDF, XLSX, интеграционный HTTP-клиент, настройки интеграций, лимиты, метрики).
 */
@Global()
@Module({})
export class PlatformModule implements NestModule {
  static forRoot(config: Config) {
    return {
      module: PlatformModule,
      imports: [DatabaseModule, EventsModule],
      controllers: [HealthController, FilesController],
      providers: [
        { provide: Config, useValue: config },
        { provide: Clock, useClass: SystemClock },
        { provide: HttpTransport, useClass: FetchTransport },
        { provide: FileStorage, useFactory: (c: Config) => createFileStorage(c), inject: [Config] },
        AuditLog,
        SecretBox,
        IntegrationLog,
        ExternalHttp,
        IntegrationSettings,
        IntegrationCatalog,
        PdfRenderer,
        XlsxBuilder,
        DocumentNumbering,
        RedisConnection,
        RateLimiter,
        MetricsService,
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
      ],
      exports: [
        Config,
        Clock,
        HttpTransport,
        FileStorage,
        AuditLog,
        SecretBox,
        IntegrationLog,
        ExternalHttp,
        IntegrationSettings,
        IntegrationCatalog,
        PdfRenderer,
        XlsxBuilder,
        DocumentNumbering,
        RedisConnection,
        RateLimiter,
        MetricsService,
        DatabaseModule,
        EventsModule,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
