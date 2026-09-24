import { types } from 'pg';

let configured = false;

/**
 * Парсеры типов PostgreSQL:
 * - int8 (bigint) -> number: деньги в тиынах; проверяем, что значение безопасно для JS.
 * - numeric -> string: не допускаем неявных float.
 * - date -> 'YYYY-MM-DD' строкой, без сдвига часового пояса.
 */
export function configurePgTypes(): void {
  if (configured) return;
  configured = true;
  types.setTypeParser(types.builtins.INT8, (value: string) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) {
      throw new Error(`int8 value ${value} exceeds JS safe integer range`);
    }
    return n;
  });
  types.setTypeParser(types.builtins.NUMERIC, (value: string) => value);
  types.setTypeParser(types.builtins.DATE, (value: string) => value);
}
