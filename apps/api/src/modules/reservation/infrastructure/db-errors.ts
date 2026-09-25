/** Коды ошибок PostgreSQL, которые модуль переводит в доменные исключения. */
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_UNIQUE_VIOLATION = '23505';

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
}

export function pgErrorCode(err: unknown): string | null {
  const code = (err as PgErrorLike | null)?.code;
  return typeof code === 'string' ? code : null;
}

export function pgConstraint(err: unknown): string | null {
  const constraint = (err as PgErrorLike | null)?.constraint;
  return typeof constraint === 'string' ? constraint : null;
}

/** Нарушение exclusion constraint пересечения интервалов по месту (вторая линия защиты от двойной брони). */
export function isOverlapViolation(err: unknown): boolean {
  return pgErrorCode(err) === PG_EXCLUSION_VIOLATION;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  return pgErrorCode(err) === PG_UNIQUE_VIOLATION && (constraint === undefined || pgConstraint(err) === constraint);
}
