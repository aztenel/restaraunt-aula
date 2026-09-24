import { Client } from 'pg';
import { Kysely, sql } from 'kysely';
import { createKysely } from '../../src/shared/infrastructure/database/kysely.factory';
import { runMigrations } from '../../src/shared/infrastructure/database/migration-runner';

const prepared = new Set<string>();

/** Создаёт тестовую базу (если нет) и применяет миграции указанных модулей (платформа — всегда). */
export async function prepareTestDatabase(url: string, modules?: string[]): Promise<void> {
  const key = `${url}|${modules?.join(',') ?? '*'}`;
  if (prepared.has(key)) return;
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('select 1 from pg_database where datname = $1', [dbName]);
    if (exists.rowCount === 0) {
      await client.query(`create database "${dbName.replace(/"/g, '')}"`);
    }
  } finally {
    await client.end();
  }
  const db = createKysely({ url, poolMax: 2 });
  try {
    await runMigrations(db, { modules });
  } finally {
    await db.destroy();
  }
  prepared.add(key);
}

/** Очистить все таблицы модулей и платформы (кроме журнала миграций). */
export async function truncateAll(db: Kysely<any>): Promise<void> {
  const tables = await sql<{ schema: string; table: string }>`
    select table_schema as schema, table_name as table
    from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema not in ('pg_catalog', 'information_schema', 'public')
      and not (table_schema = 'platform' and table_name = 'schema_migrations')`.execute(db);
  if (tables.rows.length === 0) return;
  const list = tables.rows.map((t) => `"${t.schema}"."${t.table}"`).join(', ');
  await sql.raw(`truncate table ${list} restart identity cascade`).execute(db);
}
