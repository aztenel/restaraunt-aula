/**
 * Окружение e2e: адреса витрины и API, учётная запись собственника (сид с SEED_OWNER_PASSWORD),
 * журнал API для кодов SMS (канал «log» в dev пишет текст сообщения целиком). См. e2e/stack.md.
 */
const trimSlash = (value: string) => value.replace(/\/+$/, '');

export const WEB_URL = trimSlash(process.env.E2E_WEB_URL || 'http://localhost:3401');
export const API_URL = trimSlash(process.env.E2E_API_URL || 'http://localhost:3400');

export const OWNER = {
  email: process.env.E2E_OWNER_EMAIL || process.env.SEED_OWNER_EMAIL || 'owner@aula.kz',
  password: process.env.E2E_OWNER_PASSWORD || process.env.SEED_OWNER_PASSWORD || '',
};

/** Файл stdout API (NODE_ENV=development, LOG_LEVEL=info): оттуда берём коды SMS. Пусто — тест с SMS пропускается. */
export const API_LOG = process.env.E2E_API_LOG || '';

/** Демо-филиалы сида (SEED_DEMO=true). */
export const DEMO = {
  deliveryBranch: process.env.E2E_DELIVERY_BRANCH || 'greenline',
  bookingBranch: process.env.E2E_BOOKING_BRANCH || 'garden-view',
  promoCode: process.env.E2E_PROMO_CODE || 'WELCOME10',
};
