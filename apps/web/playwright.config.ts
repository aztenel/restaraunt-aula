/**
 * Браузерные e2e витрины против запущенного стека (API + витрина + PostgreSQL/Redis с демо-сидом).
 * Как поднять стек локально и в CI — apps/web/e2e/stack.md. Серверы этот конфиг не запускает.
 *
 *   E2E_WEB_URL   витрина (по умолчанию http://localhost:3401)
 *   E2E_API_URL   API (по умолчанию http://localhost:3400)
 *   E2E_OWNER_PASSWORD / SEED_OWNER_PASSWORD  пароль собственника из сида (смета и счёт банкета)
 *   E2E_API_LOG   файл stdout API — коды SMS канала «log» (тест оплаты при получении)
 */
import { defineConfig, devices } from '@playwright/test';

const WEB_URL = (process.env.E2E_WEB_URL || 'http://localhost:3401').replace(/\/+$/, '');
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // Сценарии создают заказы, брони и платежи в общей БД стенда — по одному, без гонок за места.
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS || 1),
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: CI
    ? [['list'], ['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: WEB_URL,
    locale: 'ru-RU',
    timezoneId: 'Asia/Almaty',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      // SEO и словари не зависят от ширины экрана — только в desktop.
      testIgnore: [/seo\.spec\.ts$/, /i18n\.spec\.ts$/],
    },
  ],
});
