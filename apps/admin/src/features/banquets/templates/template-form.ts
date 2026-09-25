/**
 * Шаблон договора: подстановки {{ path.to.value }} (как shared/kernel/template.ts на сервере).
 * Список допустимых подстановок приходит с сервера (GET /contract-templates/placeholders);
 * здесь — только поиск подстановок в тексте и подсветка неизвестных до сохранения.
 */
export const TEMPLATE_CODE_PATTERN = /^[a-z0-9_-]{2,60}$/;
export const MIN_TEMPLATE_LENGTH = 20;
export const MAX_TEMPLATE_LENGTH = 100_000;

const VARIABLE_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Подстановки, встречающиеся в тексте (в порядке появления, без повторов). */
export function templateVariables(body: string): string[] {
  return [...new Set([...body.matchAll(VARIABLE_RE)].map((m) => m[1]!))];
}

/** Подстановки, которых нет в списке сервера (сервер отклонит шаблон: banquet_template.unknown_placeholders). */
export function unknownPlaceholders(body: string, known: readonly string[]): string[] {
  const allowed = new Set(known);
  return templateVariables(body).filter((v) => !allowed.has(v));
}

/** Список неизвестных подстановок из деталей ошибки сервера. */
export function unknownFromErrorDetails(details: Record<string, unknown>): string[] {
  const unknown = details.unknown;
  return Array.isArray(unknown) ? unknown.filter((v): v is string => typeof v === 'string') : [];
}

/** Вставить подстановку в позицию курсора. */
export function insertPlaceholder(body: string, key: string, selectionStart: number | null, selectionEnd: number | null): { body: string; caret: number } {
  const token = `{{${key}}}`;
  const start = selectionStart ?? body.length;
  const end = selectionEnd ?? start;
  return { body: body.slice(0, start) + token + body.slice(end), caret: start + token.length };
}

/** Группа подстановки для панели: 'seller.name' → 'seller'. */
export function placeholderGroup(key: string): string {
  return key.split('.')[0] ?? key;
}
