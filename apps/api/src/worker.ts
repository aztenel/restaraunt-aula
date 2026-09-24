import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { Config, loadEnvFileIfPresent } from './shared/infrastructure/config/config';
import { BullmqRuntime } from './shared/infrastructure/events/bullmq-runtime';
import { initSentry } from './shared/infrastructure/logging/sentry';

/**
 * Фоновый процесс: relay outbox -> очередь, обработчики событий, задачи интеграций
 * (платежи, мессенджеры, POS, доставка), периодические задачи. HTTP не слушает.
 */
async function bootstrap(): Promise<void> {
  loadEnvFileIfPresent();
  const config = new Config();
  initSentry(config, 'worker');
  if (config.queue.driver !== 'bullmq') {
    throw new Error('Worker requires QUEUE_DRIVER=bullmq');
  }
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.get(BullmqRuntime).start({ concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5) });
}

void bootstrap();
