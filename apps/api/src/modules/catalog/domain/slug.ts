import { ValidationError } from '../../../shared/kernel/errors';
import { Translatable } from '../../../shared/kernel/translatable';

/**
 * Человекочитаемые URL (SEO): slug из латиницы, цифр и дефисов.
 * Если slug не задан — транслитерация из названия (ru, иначе kk, иначе en).
 */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 80;

/** Транслитерация кириллицы (русский + казахский алфавит) в латиницу для URL. */
const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  // Казахские буквы.
  ә: 'a',
  ғ: 'g',
  қ: 'q',
  ң: 'n',
  ө: 'o',
  ұ: 'u',
  ү: 'u',
  һ: 'h',
  і: 'i',
};

export function transliterate(text: string): string {
  let out = '';
  for (const ch of text.toLowerCase()) {
    out += TRANSLIT[ch] ?? ch;
  }
  return out;
}

/** Slug из произвольного текста: транслитерация, всё кроме a-z0-9 -> дефис. Пустая строка, если нечего взять. */
export function slugify(text: string): string {
  // Сначала кириллица (NFKD разложил бы «й» на «и» + знак), затем диакритика латиницы (è -> e).
  const base = transliterate(text.normalize('NFC'))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return trimSlug(base);
}

function trimSlug(slug: string, max = SLUG_MAX_LENGTH): string {
  if (slug.length <= max) return slug;
  return slug.slice(0, max).replace(/-+$/g, '');
}

/** Текст-источник для автоматического slug: ru, затем kk, затем en. */
export function slugSource(name: Translatable): string {
  return name.ru ?? name.kk ?? name.en ?? '';
}

/** Проверка slug, заданного вручную. */
export function assertSlug(value: string, field = 'slug'): string {
  const slug = value.trim().toLowerCase();
  if (!SLUG_RE.test(slug) || slug.length > SLUG_MAX_LENGTH) {
    throw new ValidationError('catalog.invalid_slug', `${field}: latin letters, digits and dashes, up to ${SLUG_MAX_LENGTH} chars`, {
      field,
      value,
    });
  }
  return slug;
}

/** Кандидат номер n для занятого slug: 'plov' -> 'plov-2'. */
export function slugCandidate(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  return `${trimSlug(base, SLUG_MAX_LENGTH - suffix.length)}${suffix}`;
}

/**
 * Уникальный slug: заданный вручную должен быть свободен (иначе conflict у вызывающего),
 * автоматический получает суффикс -2, -3, ... Проверка занятости передаётся извне.
 */
export async function generateUniqueSlug(
  name: Translatable,
  fallback: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(slugSource(name)) || fallback;
  for (let attempt = 1; attempt < 1000; attempt++) {
    const candidate = slugCandidate(base, attempt);
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new ValidationError('catalog.slug_unavailable', 'Cannot generate a unique slug', { base });
}
