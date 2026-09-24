import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { Kysely, sql } from 'kysely';

/**
 * Миграции только вперёд. Каждый модуль держит свои SQL-файлы в <module>/infrastructure/migrations,
 * платформа — в shared/infrastructure/database/migrations. Имя файла: YYYYMMDDHHMM_описание.sql.
 * Все файлы применяются в порядке имени; применённый файл нельзя менять (проверка checksum).
 */
export interface MigrationFile {
  id: string;
  module: string;
  path: string;
  checksum: string;
  sql: string;
}

const MIGRATION_NAME_RE = /^\d{12}_[a-z0-9_]+\.sql$/;
const LOCK_ID = 847_200_1;

/** Корень исходников: src/ при разработке, dist/ в продакшене. */
export function defaultMigrationsRoot(): string {
  return resolve(__dirname, '..', '..', '..');
}

function moduleOf(root: string, file: string): string {
  const parts = relative(root, file).split(sep);
  if (parts[0] === 'modules' && parts[1]) return parts[1];
  return 'platform';
}

function walk(dir: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, acc);
    } else if (entry.endsWith('.sql') && full.split(sep).includes('migrations')) {
      acc.push(full);
    }
  }
  return acc;
}

export function discoverMigrations(root: string = defaultMigrationsRoot(), modules?: string[]): MigrationFile[] {
  const files = walk(root, []);
  const result: MigrationFile[] = [];
  const seen = new Map<string, string>();
  for (const path of files) {
    const id = basename(path);
    if (!MIGRATION_NAME_RE.test(id)) {
      throw new Error(`Migration file name must match YYYYMMDDHHMM_name.sql: ${path}`);
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate migration id ${id}: ${seen.get(id)} and ${path}`);
    }
    seen.set(id, path);
    const module = moduleOf(root, path);
    if (modules && module !== 'platform' && !modules.includes(module)) continue;
    const content = readFileSync(path, 'utf8');
    result.push({
      id,
      module,
      path,
      sql: content,
      checksum: createHash('sha256').update(content).digest('hex'),
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export interface MigrationResult {
  applied: string[];
  skipped: number;
}

export async function runMigrations(
  db: Kysely<any>,
  options: { root?: string; modules?: string[]; log?: (msg: string) => void } = {},
): Promise<MigrationResult> {
  const log = options.log ?? (() => undefined);
  const migrations = discoverMigrations(options.root, options.modules);
  return db.connection().execute(async (conn) => {
    await sql`select pg_advisory_lock(${LOCK_ID})`.execute(conn);
    try {
      await sql`create schema if not exists platform`.execute(conn);
      await sql`
        create table if not exists platform.schema_migrations (
          id text primary key,
          module text not null,
          checksum text not null,
          applied_at timestamptz not null default now()
        )`.execute(conn);
      const rows = await sql<{ id: string; checksum: string }>`select id, checksum from platform.schema_migrations`.execute(
        conn,
      );
      const applied = new Map(rows.rows.map((r) => [r.id, r.checksum]));
      const done: string[] = [];
      for (const m of migrations) {
        const existing = applied.get(m.id);
        if (existing) {
          if (existing !== m.checksum) {
            throw new Error(
              `Migration ${m.id} was modified after being applied. Migrations are forward-only: add a new migration instead.`,
            );
          }
          continue;
        }
        log(`Applying ${m.module}/${m.id}`);
        await conn.transaction().execute(async (trx) => {
          await sql.raw(m.sql).execute(trx);
          await sql`insert into platform.schema_migrations (id, module, checksum) values (${m.id}, ${m.module}, ${m.checksum})`.execute(
            trx,
          );
        });
        done.push(m.id);
      }
      return { applied: done, skipped: migrations.length - done.length };
    } finally {
      await sql`select pg_advisory_unlock(${LOCK_ID})`.execute(conn);
    }
  });
}
