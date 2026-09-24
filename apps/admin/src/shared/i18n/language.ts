/** Язык интерфейса админки: русский (по умолчанию) и казахский. Хранится в localStorage. */
export const ADMIN_LANGUAGES = ['ru', 'kk'] as const;
export type AdminLanguage = (typeof ADMIN_LANGUAGES)[number];

const STORAGE_KEY = 'aula_admin_lang';

export function isAdminLanguage(value: unknown): value is AdminLanguage {
  return typeof value === 'string' && (ADMIN_LANGUAGES as readonly string[]).includes(value);
}

export function detectInitialLanguage(): AdminLanguage {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isAdminLanguage(stored)) return stored;
  } catch {
    // localStorage недоступен
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('kk')) return 'kk';
  return 'ru';
}

let current: AdminLanguage = 'ru';

export function currentLanguage(): AdminLanguage {
  return current;
}

export function rememberLanguage(language: AdminLanguage): void {
  current = language;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // no-op
  }
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}
