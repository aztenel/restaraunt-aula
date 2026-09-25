/**
 * Локальные даты без времени ('YYYY-MM-DD', Asia/Almaty) — последний день действия сертификата,
 * фильтры по дате: форматирование без перевода в UTC (строка уже локальная).
 */

/** 'YYYY-MM-DD' → 'DD.MM.YYYY'; иное значение возвращается как есть, пустое — «—». */
export function formatLocalDate(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : ymd;
}
