import { ValidationError } from '../../../shared/kernel/errors';
import { MINOR_UNITS_PER_MAJOR, MoneyJson } from '../../../shared/kernel/money';
import { CustomerFilter } from './customer-filter';

/**
 * Выгрузка базы гостей (защита ПД): маркетинговая выгрузка — только гости с маркетинговым согласием;
 * сервисная (purpose=service: обзвон по действующим заказам/банкетам, сверка) — без этого ограничения,
 * но цель фиксируется в журнале. Обезличенные гости не выгружаются никогда.
 */
export const ExportPurpose = { Marketing: 'marketing', Service: 'service' } as const;
export type ExportPurpose = (typeof ExportPurpose)[keyof typeof ExportPurpose];
export const EXPORT_PURPOSES = Object.values(ExportPurpose) as ExportPurpose[];

export const ExportFormat = { Xlsx: 'xlsx', Csv: 'csv' } as const;
export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];
export const EXPORT_FORMATS = Object.values(ExportFormat) as ExportFormat[];

/** Больше — только с уточнением фильтра (выгрузка всей базы одним файлом — риск утечки ПД). */
export const MAX_EXPORT_ROWS = 50_000;

export function exportFilter(purpose: ExportPurpose, filter: CustomerFilter): CustomerFilter {
  if (purpose === ExportPurpose.Marketing) {
    if (filter.marketingConsent === false) {
      throw new ValidationError('customer_export.marketing_requires_consent', 'Marketing export includes only guests with marketing consent');
    }
    return { ...filter, marketingConsent: true };
  }
  return { ...filter };
}

export interface ExportRow {
  phone: string;
  name: string | null;
  email: string | null;
  locale: string;
  birthday: string | null;
  tags: string[];
  ordersCount: number;
  completedOrdersCount: number;
  totalSpent: MoneyJson;
  reservationsCount: number;
  noShowCount: number;
  banquetsCount: number;
  marketingConsent: boolean;
  firstSeenAt: Date;
  lastActivityAt: Date | null;
}

export interface ExportColumn {
  key: keyof ExportRow;
  header: string;
  format?: 'text' | 'number' | 'money' | 'date' | 'datetime';
}

export const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: 'phone', header: 'Телефон' },
  { key: 'name', header: 'Имя' },
  { key: 'email', header: 'Email' },
  { key: 'locale', header: 'Язык' },
  { key: 'birthday', header: 'День рождения' },
  { key: 'tags', header: 'Теги' },
  { key: 'ordersCount', header: 'Заказов', format: 'number' },
  { key: 'completedOrdersCount', header: 'Выполнено заказов', format: 'number' },
  { key: 'totalSpent', header: 'Сумма покупок, ₸', format: 'money' },
  { key: 'reservationsCount', header: 'Броней', format: 'number' },
  { key: 'noShowCount', header: 'Неявок', format: 'number' },
  { key: 'banquetsCount', header: 'Банкетов', format: 'number' },
  { key: 'marketingConsent', header: 'Согласие на рассылки' },
  { key: 'firstSeenAt', header: 'Первое обращение', format: 'datetime' },
  { key: 'lastActivityAt', header: 'Последняя активность', format: 'datetime' },
];

/** Тиыны -> '12500.50' (целочисленно, без float). */
export function formatTenge(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const major = Math.trunc(abs / MINOR_UNITS_PER_MAJOR);
  const minor = abs % MINOR_UNITS_PER_MAJOR;
  return `${sign}${major}.${String(minor).padStart(2, '0')}`;
}

/**
 * Ячейка CSV (RFC 4180): кавычки при необходимости; защита от CSV-инъекции — текст,
 * начинающийся с = + - @ (кроме нормализованного телефона), предваряется апострофом.
 */
export function csvCell(value: string, trusted = false): string {
  let text = value;
  if (!trusted && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Значение строки для текстовых форматов. Даты — локальное время (formatDate передаётся снаружи). */
export function exportCellText(row: ExportRow, column: ExportColumn, formatDate: (d: Date) => string): string {
  const value = row[column.key];
  if (value === null || value === undefined) return '';
  if (column.format === 'money') return formatTenge((value as MoneyJson).amount);
  if (value instanceof Date) return formatDate(value);
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  return String(value);
}

/** CSV в UTF-8 с BOM (Excel корректно открывает кириллицу), разделитель — запятая, строки CRLF. */
export function buildCsv(rows: readonly ExportRow[], formatDate: (d: Date) => string): Buffer {
  const lines = [EXPORT_COLUMNS.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(EXPORT_COLUMNS.map((c) => csvCell(exportCellText(row, c, formatDate), c.key === 'phone')).join(','));
  }
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8')]);
}

export function exportFileName(purpose: ExportPurpose, format: ExportFormat, localDate: string): string {
  return `aula-customers-${purpose}-${localDate}.${format}`;
}
