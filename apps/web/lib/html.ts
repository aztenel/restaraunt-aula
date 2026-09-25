/**
 * HTML текстовых страниц и акций приходит с сервера уже санитизированным (sanitize-html,
 * белый список тегов — apps/api/src/modules/catalog/domain/html.ts). Перед вставкой витрина
 * дополнительно вырезает всё исполняемое (защита в глубину на случай ошибки конфигурации
 * или прокси): скрипты, стили, фреймы, формы, обработчики событий, javascript:/data:-ссылки.
 */

/** Элементы, которые удаляются вместе с содержимым. */
const BLOCK_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'frameset', 'textarea', 'select', 'form'];
/** Одиночные/оставшиеся теги, которые удаляются (содержимое, если есть, остаётся текстом). */
const DROP_TAGS = [...BLOCK_TAGS, 'frame', 'link', 'meta', 'base', 'input', 'button', 'option', 'applet', 'img', 'video', 'audio', 'source', 'picture'];

const BLOCK_RE = new RegExp(`<(${BLOCK_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
const DROP_RE = new RegExp(`<\\/?(?:${DROP_TAGS.join('|')})\\b[^>]*>`, 'gi');
const COMMENT_RE = /<!--[\s\S]*?-->/g;
/** Обработчики событий и опасные атрибуты. */
const UNSAFE_ATTR_RE = /\s(?:on[a-z]+|style|srcdoc|formaction|xmlns(?::[a-z]+)?)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTR_RE = /\s(href|src|xlink:href|action|background|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const SAFE_URL_RE = /^(?:https?:|mailto:|tel:|#|\/(?!\/)|(?!\/\/)[^:/?#]*(?:[/?#]|$))/i;

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16) || 0x20))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number(dec) || 0x20))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;|&newline;/gi, '');
}

/** Ссылка безопасна: http(s), mailto, tel, относительный путь или якорь. */
export function isSafeUrl(value: string): boolean {
  // Пробелы и управляющие символы внутри схемы («java\tscript:») браузер игнорирует — убираем их для проверки.
  const normalized = decodeEntities(value).replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  return SAFE_URL_RE.test(normalized);
}

export function stripUnsafeHtml(html: string): string {
  let out = html.replace(COMMENT_RE, '');
  // Повторяем, пока есть что удалять (вложенные/склеенные конструкции вида <scr<script>ipt>).
  for (let i = 0; i < 5; i++) {
    const next = out.replace(BLOCK_RE, '').replace(DROP_RE, '');
    if (next === out) break;
    out = next;
  }
  out = out.replace(UNSAFE_ATTR_RE, '');
  out = out.replace(URL_ATTR_RE, (match, name: string, dq?: string, sq?: string, bare?: string) => {
    const value = dq ?? sq ?? bare ?? '';
    return isSafeUrl(value) ? match : ` ${name}="#"`;
  });
  // Ссылки в новом окне — без доступа к window.opener.
  out = out.replace(/<a\b([^>]*\btarget\s*=\s*["']?_blank["']?[^>]*)>/gi, (match, attrs: string) =>
    /\brel\s*=/.test(attrs) ? match : `<a${attrs} rel="noopener noreferrer">`,
  );
  return out.trim();
}

/** Текст без разметки (для description/сниппетов). */
export function htmlToText(html: string): string {
  return stripUnsafeHtml(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
