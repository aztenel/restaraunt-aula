import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { configurePgTypes } from './pg-types';

export interface KyselyOptions {
  url: string;
  poolMax?: number;
  statementTimeoutMs?: number;
  applicationName?: string;
}

export function createKysely(options: KyselyOptions): Kysely<any> {
  configurePgTypes();
  const pool = new Pool({
    connectionString: options.url,
    max: options.poolMax ?? 10,
    application_name: options.applicationName ?? 'aula-api',
    statement_timeout: options.statementTimeoutMs,
  });
  pool.on('connect', (client) => {
    // Время в БД — всегда UTC.
    void client.query(`SET TIME ZONE 'UTC'`);
  });
  return new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
}
