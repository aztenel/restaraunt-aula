import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { MODULE_SEEDERS } from '../modules/seeders';
import { seedIdentity } from '../modules/identity/infrastructure/seed';
import { Config } from '../shared/infrastructure/config/config';
import { OutboxProcessor } from '../shared/infrastructure/events/outbox-processor';

/**
 * Стартовые данные: юрлицо, филиалы, собственник и администратор, настройки модулей.
 * SEED_DEMO=true добавляет демо-данные (сотрудники, меню, залы) для dev/staging.
 *
 *   SEED_OWNER_EMAIL=owner@aula.kz SEED_ADMIN_EMAIL=admin@aula.kz pnpm --filter @aula/api seed
 */
async function main(): Promise<void> {
  process.env.QUEUE_DRIVER = 'inline';
  process.env.QUEUE_INLINE_AUTODRAIN = 'false';
  const config = new Config();
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), { logger: ['error', 'warn'] });
  const log = (m: string) => console.log(`[seed] ${m}`);
  const demo = process.env.SEED_DEMO === 'true';
  try {
    const identity = await seedIdentity(app, {
      demo,
      ownerEmail: process.env.SEED_OWNER_EMAIL ?? 'owner@aula.kz',
      ownerPassword: process.env.SEED_OWNER_PASSWORD,
      adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@aula.kz',
      adminPassword: process.env.SEED_ADMIN_PASSWORD,
      log,
    });
    for (const seeder of MODULE_SEEDERS) {
      log(`Модуль ${seeder.module}`);
      await seeder.seed({ app, ...identity, demo, log });
    }
    // События, порождённые сидами (например, пересчёт витрины), обрабатываем сразу.
    await app.get(OutboxProcessor).drain();
    log('Готово');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
