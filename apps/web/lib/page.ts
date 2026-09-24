import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { routing, type AppLocale } from '@/i18n/routing';

export type LocaleParams = Promise<{ locale: string }>;

/** Проверить язык из URL (иначе 404) и зафиксировать его для next-intl в серверных компонентах. */
export async function resolveLocale(params: Promise<{ locale: string }>): Promise<AppLocale> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return locale;
}
