/**
 * Общие фикстуры e2e: «гость» (телефон, email, свой IP клиента для лимитов API) и проверка,
 * что на страницах не было необработанных ошибок JavaScript.
 */
import { test as base, expect } from '@playwright/test';
import { newGuest, type Guest } from './guest';

export const test = base.extend<{ guest: Guest; pageErrors: string[] }>({
  // Второй аргумент фикстуры — не React-хук, поэтому назван provide (правило react-hooks/rules-of-hooks).
  guest: async ({}, provide) => {
    await provide(newGuest());
  },
  // Все запросы браузера (витрина, API, песочница оплаты) — от IP «гостя».
  extraHTTPHeaders: async ({ guest }, provide) => {
    await provide({ 'x-forwarded-for': guest.ip });
  },
  pageErrors: [
    async ({ page }, provide) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await provide(errors);
      expect(errors, 'необработанные ошибки JavaScript на странице').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
