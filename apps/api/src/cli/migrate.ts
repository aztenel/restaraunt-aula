import 'reflect-metadata';
import { Config, loadEnvFileIfPresent } from '../shared/infrastructure/config/config';
import { createKysely } from '../shared/infrastructure/database/kysely.factory';
import { runMigrations } from '../shared/infrastructure/database/migration-runner';

/** Применить миграции (только вперёд). Используется при деплое до запуска новой версии. */
async function main(): Promise<void> {
  loadEnvFileIfPresent();
  const config = new Config();
  const db = createKysely({ url: config.database.url, poolMax: 2, applicationName: 'aula-migrate' });
  try {
    const result = await runMigrations(db, { log: (m) => console.log(m) });
    console.log(`Migrations applied: ${result.applied.length}, already applied: ${result.skipped}`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
