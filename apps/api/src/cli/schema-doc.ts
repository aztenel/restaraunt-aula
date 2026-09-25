import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import { Config, loadEnvFileIfPresent } from '../shared/infrastructure/config/config';
import { createKysely } from '../shared/infrastructure/database/kysely.factory';

/**
 * Генерация docs/database-schema.md по живой базе (после миграций): схемы модулей, таблицы,
 * столбцы, ключи, ограничения, индексы и триггеры. Входит в комплект передачи проекта.
 *
 *   pnpm --filter @aula/api migrate && pnpm --filter @aula/api db:schema-doc
 */
interface Column {
  schema: string;
  table: string;
  column: string;
  type: string;
  nullable: string;
  default: string | null;
}

interface Constraint {
  schema: string;
  table: string;
  name: string;
  type: string;
  definition: string;
}

const MODULE_TITLES: Record<string, string> = {
  platform: 'Платформа (outbox, аудит, интеграции, нумерация)',
  identity: 'Identity — филиалы, юрлица, пользователи, роли',
  catalog: 'Catalog — меню, цены по филиалам, стоп-лист, контент',
  ordering: 'Ordering — заказы, зоны доставки, промокоды, курьеры',
  reservation: 'Reservation — залы, места, брони',
  banquet: 'Banquet — заявки, сметы, счета, документы, ЭСФ',
  payments: 'Payments — платежи, возвраты, сертификаты',
  customers: 'Customers — гости, согласия, история, сегменты',
  notifications: 'Notifications — сообщения, шаблоны, лента админки',
  reporting: 'Reporting — проекции для отчётов (только чтение)',
  pos: 'POS — выгрузки заказов, сопоставления, синхронизация стоп-листа',
};

async function main(): Promise<void> {
  loadEnvFileIfPresent();
  const config = new Config();
  const db = createKysely({ url: config.database.url, poolMax: 2, applicationName: 'aula-schema-doc' });
  try {
    const schemas = Object.keys(MODULE_TITLES);
    const columns = await sql<Column>`
      select c.table_schema as schema, c.table_name as table, c.column_name as column,
             case when c.data_type = 'USER-DEFINED' then c.udt_name
                  when c.data_type = 'ARRAY' then c.udt_name
                  when c.character_maximum_length is not null then c.data_type || '(' || c.character_maximum_length || ')'
                  else c.data_type end as type,
             c.is_nullable as nullable, c.column_default as default
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = any(${schemas}) and t.table_type = 'BASE TABLE'
      order by c.table_schema, c.table_name, c.ordinal_position`.execute(db);
    const constraints = await sql<Constraint>`
      select n.nspname as schema, cl.relname as table, con.conname as name,
             case con.contype when 'p' then 'PRIMARY KEY' when 'u' then 'UNIQUE' when 'f' then 'FOREIGN KEY'
                  when 'c' then 'CHECK' when 'x' then 'EXCLUDE' else con.contype::text end as type,
             pg_get_constraintdef(con.oid) as definition
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = any(${schemas})
      order by n.nspname, cl.relname, con.contype, con.conname`.execute(db);
    const indexes = await sql<{ schema: string; table: string; name: string; definition: string }>`
      select schemaname as schema, tablename as table, indexname as name, indexdef as definition
      from pg_indexes where schemaname = any(${schemas})
        and indexname not in (select conname from pg_constraint)
      order by schemaname, tablename, indexname`.execute(db);
    const triggers = await sql<{ schema: string; table: string; name: string; definition: string }>`
      select n.nspname as schema, c.relname as table, t.tgname as name, pg_get_triggerdef(t.oid) as definition
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname = any(${schemas})
      order by n.nspname, c.relname, t.tgname`.execute(db);
    const migrations = await sql<{ id: string; module: string }>`select id, module from platform.schema_migrations order by id`.execute(db);

    const out: string[] = [];
    out.push('# Схема базы данных AULA', '');
    out.push(
      'Документ сгенерирован командой `pnpm --filter @aula/api db:schema-doc` по базе после применения всех миграций.',
      'Не редактировать вручную. Каждый модуль владеет своей схемой PostgreSQL и не обращается к таблицам других модулей;',
      'внешних ключей между схемами нет (модуль можно вынести в отдельный сервис). Деньги — `*_amount bigint` (тиыны) + `*_currency`;',
      'время — `timestamptz` (UTC); переводимые поля — `jsonb` `{kk, ru, en}`; физическое удаление заказов, платежей и броней запрещено триггером.',
      '',
    );
    out.push('## Миграции', '', '| Файл | Модуль |', '| --- | --- |');
    for (const m of migrations.rows) out.push(`| ${m.id} | ${m.module} |`);
    out.push('');
    for (const schema of schemas) {
      const tables = [...new Set(columns.rows.filter((c) => c.schema === schema).map((c) => c.table))];
      if (tables.length === 0) continue;
      out.push(`## Схема \`${schema}\` — ${MODULE_TITLES[schema]}`, '');
      for (const table of tables) {
        out.push(`### \`${schema}.${table}\``, '', '| Столбец | Тип | NULL | По умолчанию |', '| --- | --- | --- | --- |');
        for (const c of columns.rows.filter((x) => x.schema === schema && x.table === table)) {
          out.push(`| ${c.column} | ${c.type} | ${c.nullable === 'YES' ? 'да' : 'нет'} | ${c.default ? `\`${c.default.replace(/\|/g, '\\|')}\`` : ''} |`);
        }
        const cons = constraints.rows.filter((x) => x.schema === schema && x.table === table);
        if (cons.length) {
          out.push('', 'Ограничения:', '');
          for (const k of cons) out.push(`- ${k.type} \`${k.name}\`: \`${k.definition.replace(/\|/g, '\\|')}\``);
        }
        const idx = indexes.rows.filter((x) => x.schema === schema && x.table === table);
        if (idx.length) {
          out.push('', 'Индексы:', '');
          for (const i of idx) out.push(`- \`${i.definition}\``);
        }
        const trg = triggers.rows.filter((x) => x.schema === schema && x.table === table);
        if (trg.length) {
          out.push('', 'Триггеры:', '');
          for (const t of trg) out.push(`- \`${t.definition}\``);
        }
        out.push('');
      }
    }
    const target = resolve(__dirname, '..', '..', '..', '..', 'docs', 'database-schema.md');
    writeFileSync(target, `${out.join('\n')}\n`);
    console.log(`Schema documented: ${target}`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
