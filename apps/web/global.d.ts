import type { routing } from './i18n/routing';
import type messages from './messages/ru.json';

// Типизация next-intl: ключи сообщений проверяются компилятором (ru.json — эталон).
declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    ym?: (counterId: number, method: string, ...args: unknown[]) => void;
  }
}
