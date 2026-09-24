import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Архитектурные проверки (условия приёмки из ТЗ), дополняют eslint-boundaries:
 * 1. Модуль обращается только к таблицам своей схемы PostgreSQL (не к чужим и не к platform напрямую).
 * 2. Миграции модуля создают объекты только в своей схеме.
 * 3. Деньги не считаются во float: в доменном коде нет parseFloat/toFixed по суммам.
 * 4. Имена провайдеров интеграций не встречаются вне адаптеров и конфигурации.
 */
const SRC = __dirname;
const MODULES_DIR = join(SRC, 'modules');
const MODULES = readdirSync(MODULES_DIR).filter((m) => statSync(join(MODULES_DIR, m)).isDirectory());

function files(dir: string, ext: string[], acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, ext, acc);
    else if (ext.some((e) => full.endsWith(e))) acc.push(full);
  }
  return acc;
}

const SCHEMAS = [...MODULES, 'platform'].join('|');
// Обращения к таблицам: Kysely-построители и сырой SQL (from/join/into/update/table/references/on).
const tableRefs = [
  new RegExp(`(?:selectFrom|insertInto|updateTable|deleteFrom|innerJoin|leftJoin|rightJoin|fullJoin|mergeInto)\\(\\s*['"\`](${SCHEMAS})\\.([a-z_]+)`, 'g'),
  new RegExp(`\\b(?:from|join|into|update|table|references|on)\\s+"?(${SCHEMAS})"?\\.([a-z_]+)`, 'gi'),
];

describe('architecture', () => {
  for (const module of MODULES) {
    it(`module ${module} touches only its own schema`, () => {
      const violations: string[] = [];
      for (const file of files(join(MODULES_DIR, module), ['.ts', '.sql'])) {
        if (file.endsWith('.spec.ts')) continue;
        const text = readFileSync(file, 'utf8');
        for (const match of tableRefs.flatMap((re) => [...text.matchAll(re)])) {
          const schema = match[1]!;
          const isSqlFunction = schema === 'platform' && /(forbid_delete|forbid_update_delete|touch_updated_at)/.test(match[2]!);
          if (schema !== module && !isSqlFunction) {
            // Упоминания в комментариях и импортах путей (identity/public) не считаем.
            const line = text.slice(text.lastIndexOf('\n', match.index!) + 1, text.indexOf('\n', match.index!));
            if (/^\s*(\/\/|\*|--|import )/.test(line) || line.includes("from '")) continue;
            violations.push(`${relative(SRC, file)}: ${match[0].trim()}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });
  }

  it('no float money arithmetic in domain code', () => {
    const violations: string[] = [];
    for (const module of MODULES) {
      const domain = join(MODULES_DIR, module, 'domain');
      try {
        statSync(domain);
      } catch {
        continue;
      }
      for (const file of files(domain, ['.ts'])) {
        if (file.endsWith('.spec.ts')) continue;
        const text = readFileSync(file, 'utf8');
        if (/parseFloat\(|\.toFixed\(/.test(text)) violations.push(relative(SRC, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it('provider names appear only in adapters and configuration', () => {
    const providers = /\b(kaspi|halyk|epay|iiko|wolt|yandex|mobizon|smsc|twilio)\b/i;
    const violations: string[] = [];
    for (const file of files(MODULES_DIR, ['.ts'])) {
      if (file.endsWith('.spec.ts')) continue;
      const rel = relative(MODULES_DIR, file);
      if (/\/(adapters|infrastructure\/adapters)\//.test(rel) || rel.endsWith('.module.ts') || /\/testing\//.test(rel)) continue;
      const code = readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      if (providers.test(code)) violations.push(rel);
    }
    expect(violations).toEqual([]);
  });
});
