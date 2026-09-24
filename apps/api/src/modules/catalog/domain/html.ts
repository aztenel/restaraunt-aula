import sanitizeHtml from 'sanitize-html';
import { LOCALES, Translatable } from '../../../shared/kernel/translatable';

/**
 * Санитизация HTML статических страниц (оферта, политика, доставка...): только безопасная разметка
 * текста — заголовки, абзацы, списки, таблицы, ссылки http/https/mailto/tel. Скрипты, стили,
 * обработчики событий и iframe вырезаются.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h2',
    'h3',
    'h4',
    'p',
    'br',
    'hr',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'small',
    'sup',
    'sub',
    'ul',
    'ol',
    'li',
    'a',
    'blockquote',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'span',
    'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => {
      const attrs = { ...attribs };
      if (attrs.target === '_blank') attrs.rel = 'noopener noreferrer';
      else delete attrs.target;
      return { tagName, attribs: attrs };
    },
  },
};

export function sanitizePageHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

/** Санитизация переводимого HTML по всем языкам; пустые языки удаляются. */
export function sanitizeTranslatableHtml(value: Translatable): Translatable {
  const result: Translatable = {};
  for (const locale of LOCALES) {
    const text = value[locale];
    if (typeof text === 'string') {
      const clean = sanitizePageHtml(text);
      if (clean) result[locale] = clean;
    }
  }
  return result;
}

/** Текст без разметки (для описания SEO по умолчанию). */
export function htmlToPlainText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
