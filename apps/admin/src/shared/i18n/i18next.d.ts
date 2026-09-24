import 'i18next';
import type { ru } from './locales/ru';

// Типизация ключей переводов: t('users.title') проверяется компилятором (эталон — ru.ts).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof ru };
    returnNull: false;
  }
}
