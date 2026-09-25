/**
 * Тексты интерфейса для селекторов — из тех же словарей, что у витрины (messages/*.json):
 * правка формулировки не ломает тесты. Подстановка простых параметров {name}; ICU-plural не нужны.
 */
import en from '../../messages/en.json';
import kk from '../../messages/kk.json';
import ru from '../../messages/ru.json';

export type Locale = 'kk' | 'ru' | 'en';
export const LOCALES: readonly Locale[] = ['kk', 'ru', 'en'];

const dictionaries: Record<Locale, unknown> = { kk, ru, en };

export function msg(key: string, params: Record<string, string | number> = {}, locale: Locale = 'ru'): string {
  let node: unknown = dictionaries[locale];
  for (const part of key.split('.')) {
    node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  }
  if (typeof node !== 'string') throw new Error(`No message ${locale}:${key}`);
  return node.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** Начало сообщения до первого параметра — для поиска текста с подставленными значениями. */
export function msgPrefix(key: string, locale: Locale = 'ru'): string {
  const text = msg(key, {}, locale);
  const index = text.indexOf('{');
  return (index < 0 ? text : text.slice(0, index)).trim();
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * «Сырой» ключ сообщения на странице (next-intl показывает Namespace.key, если перевода нет).
 * Пространства имён — верхний уровень словаря.
 */
export const RAW_KEY_RE = new RegExp(`\\b(?:${Object.keys(ru).map(escapeRegExp).join('|')})\\.[A-Za-z_][\\w.]*`);
