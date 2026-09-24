import { renderTemplate, templateVariables } from '../../../shared/kernel/template';

/**
 * Подстановка параметров в тексты уведомлений ({{param}}) и нормализация результата.
 * Параметры — уже отформатированные строки (суммы, даты, ссылки готовит модуль-отправитель).
 */

/** Остаток строки после подстановки пустых значений: пусто или только «Метка:». */
const LABEL_ONLY = /^[^:\n]{0,40}:$/;

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * Подстановка с аккуратной обработкой необязательных параметров: строка шаблона, в которой все
 * переменные оказались пустыми и осталась только метка («Пожелание: »), убирается целиком.
 * Строки без переменных не трогаются. Лишние пробелы и пустые строки схлопываются.
 */
export function renderText(template: string, params: Record<string, string>): string {
  const lines: string[] = [];
  for (const line of template.replace(/\r\n?/g, '\n').split('\n')) {
    const rendered = renderTemplate(line, params);
    const vars = templateVariables(line);
    if (vars.length > 0 && vars.every((v) => isBlank(renderTemplate(`{{${v}}}`, params)))) {
      const rest = rendered.trim();
      if (rest === '' || LABEL_ONLY.test(rest)) continue;
    }
    lines.push(rendered.replace(/[^\S\n]{2,}/g, ' ').replace(/[^\S\n]+$/g, ''));
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Переменные шаблона, не входящие в список разрешённых параметров. */
export function unknownVariables(template: string, allowed: readonly string[]): string[] {
  const set = new Set(allowed);
  return [...new Set(templateVariables(template))].filter((v) => !set.has(v));
}

export function usedVariables(template: string): string[] {
  return [...new Set(templateVariables(template))];
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * HTML-версия письма из текста: экранирование (тексты и параметры не могут внедрить разметку),
 * ссылки кликабельны, абзацы и переносы строк сохраняются.
 */
export function textToHtml(text: string, title: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) =>
      escapeHtml(p)
        .replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:#8a5a2b">${url}</a>`)
        .replace(/\n/g, '<br>'),
    )
    .map((p) => `<p style="margin:0 0 16px">${p}</p>`)
    .join('');
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${escapeHtml(title)}</title></head>` +
    '<body style="margin:0;padding:0;background:#f6f2ec">' +
    '<div style="max-width:560px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#2b2b2b">' +
    '<div style="font-size:22px;font-weight:bold;letter-spacing:2px;color:#8a5a2b;margin-bottom:24px">AULA</div>' +
    paragraphs +
    '</div></body></html>'
  );
}
