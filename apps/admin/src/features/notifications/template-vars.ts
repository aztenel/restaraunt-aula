/**
 * Переменные текстов уведомлений {{param}} — те же правила, что на сервере (shared/kernel/template.ts,
 * notifications/application/template.actions.ts): переменные — только параметры шаблона, лимит длины
 * по каналу, тема обязательна для email. Проверка до сохранения — подсказка; окончательно проверяет сервер,
 * его ошибка (notification_template.unknown_variables и др.) разбирается для показа у поля.
 */
import { toApiError } from '@aula/api-client';

export const NOTIFICATION_CHANNELS = ['whatsapp', 'sms', 'email', 'telegram'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Лимиты текста по каналам (символов). */
export const BODY_LIMITS: Record<NotificationChannel, number> = { whatsapp: 1024, sms: 1000, telegram: 4096, email: 20_000 };

const VARIABLE_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Переменные текста по порядку появления, без повторов. */
export function templateVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE_RE)].map((m) => m[1]!))];
}

export function unknownVariables(text: string, allowed: readonly string[]): string[] {
  const set = new Set(allowed);
  return templateVariables(text).filter((v) => !set.has(v));
}

export interface TextSegment {
  text: string;
  kind: 'text' | 'known' | 'unknown';
}

/** Разметка текста для подсветки: обычный текст, известная переменная, неизвестная переменная. */
export function segmentTemplate(text: string, allowed: readonly string[]): TextSegment[] {
  const set = new Set(allowed);
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(VARIABLE_RE)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: text.slice(last, index), kind: 'text' });
    segments.push({ text: match[0], kind: set.has(match[1]!) ? 'known' : 'unknown' });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), kind: 'text' });
  return segments;
}

/** Вставить {{name}} в позицию курсора; возвращает новый текст и позицию курсора после вставки. */
export function insertVariable(text: string, position: number | null | undefined, name: string): { text: string; cursor: number } {
  const at = position === null || position === undefined ? text.length : Math.min(Math.max(0, position), text.length);
  const token = `{{${name}}}`;
  return { text: text.slice(0, at) + token + text.slice(at), cursor: at + token.length };
}

export type TemplateIssueCode = 'body_required' | 'too_long' | 'subject_required' | 'unknown_variables';

export interface TemplateIssue {
  code: TemplateIssueCode;
  field: 'body' | 'subject';
  variables?: string[];
  limit?: number;
}

/** Проверка черновика до отправки (подсказки у полей). */
export function validateTemplateText(input: {
  channel: NotificationChannel;
  subject: string | null;
  body: string;
  allowed: readonly string[];
}): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  if (!input.body.trim()) issues.push({ code: 'body_required', field: 'body' });
  else if (input.body.length > BODY_LIMITS[input.channel]) issues.push({ code: 'too_long', field: 'body', limit: BODY_LIMITS[input.channel] });
  if (input.channel === 'email' && !input.subject?.trim()) issues.push({ code: 'subject_required', field: 'subject' });
  const bodyUnknown = unknownVariables(input.body, input.allowed);
  if (bodyUnknown.length > 0) issues.push({ code: 'unknown_variables', field: 'body', variables: bodyUnknown });
  const subjectUnknown = input.channel === 'email' ? unknownVariables(input.subject ?? '', input.allowed) : [];
  if (subjectUnknown.length > 0) issues.push({ code: 'unknown_variables', field: 'subject', variables: subjectUnknown });
  return issues;
}

/** Ошибка сервера при сохранении текста → проблема у поля (или null — показать общим уведомлением). */
export function issueFromApiError(error: unknown): TemplateIssue | null {
  const apiError = toApiError(error);
  const details = apiError.details;
  switch (apiError.code) {
    case 'notification_template.body_required':
      return { code: 'body_required', field: 'body' };
    case 'notification_template.subject_required':
      return { code: 'subject_required', field: 'subject' };
    case 'notification_template.too_long':
      return { code: 'too_long', field: 'body', limit: typeof details.limit === 'number' ? details.limit : undefined };
    case 'notification_template.unknown_variables': {
      const variables = Array.isArray(details.variables) ? details.variables.filter((v): v is string => typeof v === 'string') : [];
      return { code: 'unknown_variables', field: 'body', variables };
    }
    default:
      return null;
  }
}

/** Маска адресата уже приходит с сервера; здесь — только определение канала по введённому адресу для теста. */
export function channelHint(to: string): NotificationChannel | null {
  const value = to.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
  if (/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/.test(value) && !/^\+?7\d{10}$/.test(value.replace(/[\s()-]/g, ''))) return 'telegram';
  if (/^\+?[78]\d{10}$/.test(value.replace(/[\s()-]/g, ''))) return 'whatsapp';
  return null;
}
