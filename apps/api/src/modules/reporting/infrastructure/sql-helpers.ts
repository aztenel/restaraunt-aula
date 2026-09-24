import { RawBuilder, sql } from 'kysely';
import { ReportPeriod } from '../domain/period';

/**
 * Фильтр по филиалам отчёта: null — сводный по сети (все филиалы, включая строки без филиала:
 * онлайн-продажи сертификатов, выездные банкеты); список — только эти филиалы.
 */
export function branchFilter(column: string, branchIds: readonly string[] | null): RawBuilder<boolean> {
  if (branchIds === null) return sql<boolean>`true`;
  if (branchIds.length === 0) return sql<boolean>`false`;
  return sql<boolean>`${sql.ref(column)} in (${sql.join([...branchIds])})`;
}

/** Локальная дата в периоде (включительно). */
export function inPeriod(column: string, period: ReportPeriod): RawBuilder<boolean> {
  return sql<boolean>`${sql.ref(column)} between ${period.from}::date and ${period.to}::date`;
}

/**
 * Условие «входящий статус новее текущего» для upsert проекций: сначала время события,
 * при равном времени (переходы в одной транзакции) — ранг статуса.
 */
export function incomingStatusIsNewer(table: string): RawBuilder<boolean> {
  return sql<boolean>`(excluded.status_at, excluded.status_rank) >= (${sql.ref(`${table}.status_at`)}, ${sql.ref(`${table}.status_rank`)})`;
}

/** Выбор между значением из события и текущим по условию «событие новее». */
export function whenNewer(table: string, column: string): RawBuilder<unknown> {
  return sql`case when ${incomingStatusIsNewer(table)} then ${sql.ref(`excluded.${column}`)} else ${sql.ref(`${table}.${column}`)} end`;
}
