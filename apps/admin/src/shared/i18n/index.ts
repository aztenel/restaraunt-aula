/**
 * i18n админки: react-i18next, русский по умолчанию, казахский — полный перевод.
 * Язык синхронизируется с Ant Design (локаль компонентов) и dayjs (даты).
 */
import 'dayjs/locale/kk';
import 'dayjs/locale/ru';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { dayjs } from '../lib/dates';
import { detectInitialLanguage, isAdminLanguage, rememberLanguage } from './language';
import { kk } from './locales/kk';
import { ru } from './locales/ru';

export const resources = {
  ru: { translation: ru },
  kk: { translation: kk },
} as const;

const initial = detectInitialLanguage();
rememberLanguage(initial);
dayjs.locale(initial);

void i18next.use(initReactI18next).init({
  resources,
  lng: initial,
  fallbackLng: 'ru',
  supportedLngs: ['ru', 'kk'],
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18next.on('languageChanged', (language) => {
  if (!isAdminLanguage(language)) return;
  rememberLanguage(language);
  dayjs.locale(language);
});

export const i18n = i18next;
