import { isIsoDate } from '../../../shared/kernel/time';

/** '2026-10-01' -> '01.10.2026' (даты в документах и сообщениях). */
export function formatDateRu(date: string | null | undefined): string {
  if (!date || !isIsoDate(date)) return date ?? '';
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

/** Год локальной даты (для нумерации документов по году). */
export function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}
