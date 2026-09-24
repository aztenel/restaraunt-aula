import { ConflictError } from '../../../shared/kernel/errors';

/** Нарушение уникального индекса PostgreSQL (гонка двух одинаковых запросов). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

/** Выполнить fn; гонку по уникальному индексу превратить в ConflictError с машинным кодом. */
export async function guardUnique<T>(fn: () => Promise<T>, code: string, message: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError(code, message);
    throw err;
  }
}
