import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from './database';

/**
 * Номера заказов и счетов: последовательность в разрезе филиала и года.
 * Атомарный upsert ... returning — безопасен при конкурентных вызовах.
 * Вызывать внутри транзакции создания документа, чтобы номер не «сгорал» при откате.
 */
@Injectable()
export class DocumentNumbering {
  constructor(private readonly database: Database) {}

  async next(scope: string, branchId: string, year: number): Promise<number> {
    const result = await sql<{ last_value: number }>`
      insert into platform.number_sequences (scope, branch_id, year, last_value)
      values (${scope}, ${branchId}, ${year}, 1)
      on conflict (scope, branch_id, year)
      do update set last_value = platform.number_sequences.last_value + 1
      returning last_value`.execute(this.database.db());
    const row = result.rows[0];
    if (!row) throw new Error('Failed to allocate document number');
    return row.last_value;
  }

  /** Формат: <префикс>-<год>-<номер с ведущими нулями>, например A1-2026-000123. */
  static format(prefix: string, year: number, value: number, pad = 6): string {
    return `${prefix}-${year}-${String(value).padStart(pad, '0')}`;
  }
}
