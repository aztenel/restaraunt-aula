import { Controller, Get, Headers, Res, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { sql } from 'kysely';
import { Config } from '../config/config';
import { Database } from '../database/database';
import { safeEqual } from '../crypto/secret-box';
import { Public } from '../http/decorators';
import { SkipRateLimit } from '../rate-limit/rate-limit.guard';
import { RedisConnection } from '../redis/redis';
import { MetricsService } from './metrics.service';

@ApiExcludeController()
@Public()
@SkipRateLimit()
@Controller()
export class HealthController {
  constructor(
    private readonly database: Database,
    private readonly redis: RedisConnection,
    private readonly config: Config,
    private readonly metrics: MetricsService,
  ) {}

  @Get('health/live')
  live(): { status: 'ok'; release: string } {
    return { status: 'ok', release: this.config.app.release };
  }

  /** Готовность: БД и Redis доступны. Используется балансировщиком и мониторингом доступности. */
  @Get('health/ready')
  async ready(): Promise<{ status: 'ok'; checks: Record<string, string> }> {
    const checks: Record<string, string> = {};
    try {
      await sql`select 1`.execute(this.database.rootConnection());
      checks.database = 'ok';
    } catch {
      checks.database = 'down';
    }
    if (this.config.queue.driver === 'bullmq' || !this.config.isTest) {
      try {
        await this.redis.get().ping();
        checks.redis = 'ok';
      } catch {
        checks.redis = 'down';
      }
    }
    if (Object.values(checks).some((v) => v !== 'ok')) {
      throw new ServiceUnavailableException({ status: 'down', checks });
    }
    return { status: 'ok', checks };
  }

  /** Метрики Prometheus: HTTP, outbox, очередь неудач. Защищены токеном METRICS_TOKEN. */
  @Get('metrics')
  async prometheus(@Headers('authorization') auth: string | undefined, @Res() res: Response): Promise<void> {
    const token = this.config.observability.metricsToken;
    if (token && !safeEqual(auth ?? '', `Bearer ${token}`)) throw new UnauthorizedException();
    res.setHeader('content-type', this.metrics.contentType());
    res.send(await this.metrics.render());
  }
}
