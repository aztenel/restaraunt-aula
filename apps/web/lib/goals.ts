/**
 * Цели аналитики (ТЗ: Google Analytics, Яндекс.Метрика, цели). Отправляются в оба счётчика,
 * если они подключены. Вызывать из клиентских компонентов после успешного действия
 * (ответ сервера), а не по клику.
 */
import { formatFixed2ForInput, type Money } from '@aula/api-client';

export const Goals = {
  AddToCart: 'add_to_cart',
  BeginCheckout: 'begin_checkout',
  Purchase: 'purchase',
  ReservationCreated: 'reservation_created',
  BanquetRequest: 'banquet_request',
  CertificatePurchase: 'certificate_purchase',
} as const;

export type GoalName = (typeof Goals)[keyof typeof Goals];

export type GoalParams = Record<string, string | number | boolean | null | undefined | unknown[]>;

/** Номер счётчика Метрики из окружения (только цифры). */
export function yandexMetrikaId(): number | null {
  const raw = process.env.NEXT_PUBLIC_YM_ID;
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
}

/** Идентификатор GA4 из окружения (формат G-XXXXXXX). */
export function googleAnalyticsId(): string | null {
  const raw = process.env.NEXT_PUBLIC_GA_ID;
  return raw && /^G-[A-Z0-9]+$/i.test(raw) ? raw : null;
}

/**
 * Сумма для аналитики (value) — в тенге. Только отображение/отчёт: сумму посчитал сервер,
 * здесь лишь перевод тиынов в единицы валюты через строку, без арифметики.
 */
export function analyticsValue(money: Money): { value: number; currency: string } {
  return { value: Number(formatFixed2ForInput(money.amount, 'en')), currency: money.currency };
}

export function reachGoal(name: GoalName, params: GoalParams = {}): void {
  if (typeof window === 'undefined') return;
  try {
    window.gtag?.('event', name, params);
  } catch {
    // Аналитика не должна ломать витрину.
  }
  const ymId = yandexMetrikaId();
  try {
    if (ymId && window.ym) window.ym(ymId, 'reachGoal', name, params);
  } catch {
    // no-op
  }
}
