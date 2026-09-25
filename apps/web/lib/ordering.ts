/**
 * Расчёт корзины на сервере: POST /api/v1/public/orders/quote (модуль Ordering), типизированный вызов
 * по docs/openapi.json (QuoteOrderDto → OrderQuoteDto). Витрина денег НЕ считает (правила ТЗ №6 и №8):
 * названия, цены, скидка, доставка, сертификат, итог, доступность позиций и минимальная сумма —
 * только из ответа.
 */
import { ApiError, call, type ApiClient } from '@aula/api-client';
import type { OrderType, Quote, QuoteOrderBody } from './api-types';

export type { OrderType, Quote, QuoteLine } from './api-types';

export const ORDER_TYPES: readonly OrderType[] = ['pickup', 'delivery'];

export interface QuoteItem {
  dishId: string;
  quantity: number;
  modifierOptionIds: string[];
}

/** Запрос расчёта: корзина + то, что гость уже выбрал при оформлении. */
export interface QuoteRequest {
  branchId: string;
  type: OrderType;
  items: QuoteItem[];
  /** Точка доставки (выбирается на экране «Данные»). */
  deliveryPoint?: { lat: number; lng: number } | null;
  promoCode?: string | null;
  certificateCode?: string | null;
  /** Телефон гостя — для лимита промокода на один телефон. */
  phone?: string | null;
}

export type QuoteOutcome =
  | { kind: 'ok'; quote: Quote }
  /** Модуль заказов не развёрнут (404 маршрута) — показываем позиции без сумм. */
  | { kind: 'unavailable' }
  | { kind: 'error'; error: ApiError };

/**
 * Тело запроса. API отклоняет лишние поля (forbidNonWhitelisted → 400), поэтому пустые значения
 * не отправляются. Время заказа в расчёт не передаётся — его проверяет оформление.
 */
export function quoteBody(request: QuoteRequest): QuoteOrderBody {
  const body: QuoteOrderBody = {
    branchId: request.branchId,
    type: request.type,
    items: request.items.map(({ dishId, quantity, modifierOptionIds }) => ({ dishId, quantity, modifierOptionIds })),
  };
  if (request.type === 'delivery' && request.deliveryPoint) body.point = { lat: request.deliveryPoint.lat, lng: request.deliveryPoint.lng };
  const promo = request.promoCode?.trim();
  if (promo) body.promoCode = promo;
  const certificate = request.certificateCode?.trim();
  if (certificate) body.certificateCode = certificate;
  const phone = request.phone?.trim();
  if (phone) body.phone = phone;
  return body;
}

/** 404 без доменного кода (Nest отдаёт http.404 на неизвестный маршрут) — эндпоинт не развёрнут. */
export function isEndpointMissing(error: ApiError): boolean {
  return error.status === 404 && (error.code === 'http.404' || error.code === 'http.unknown');
}

export async function requestQuote(
  api: Pick<ApiClient, 'POST'>,
  request: QuoteRequest,
  options: { locale: 'kk' | 'ru' | 'en'; signal?: AbortSignal },
): Promise<QuoteOutcome> {
  try {
    const quote = await call(
      api.POST('/api/v1/public/orders/quote', {
        body: quoteBody(request),
        params: { query: { locale: options.locale } },
        signal: options.signal,
      }),
    );
    return { kind: 'ok', quote };
  } catch (error) {
    const apiError = error instanceof ApiError ? error : ApiError.network(error);
    if (isEndpointMissing(apiError)) return { kind: 'unavailable' };
    return { kind: 'error', error: apiError };
  }
}

// ---------------------------------------------------------------- Отображение проблем

/** Проблемы, которые решаются на следующем шаге оформления (адрес доставки) — в корзине это подсказка. */
export const CHECKOUT_STEP_PROBLEMS: ReadonlySet<string> = new Set(['order.address_required']);

/** Проблемы позиций (недоступно, нет в меню, модификаторы) — гость должен поправить корзину. */
export function hasLineProblems(quote: Pick<Quote, 'lines'>): boolean {
  return quote.lines.some((l) => !l.available || Boolean(l.problem));
}

/** Можно ли перейти к оформлению из корзины: нет проблем, кроме тех, что решаются при оформлении. */
export function canProceedToCheckout(quote: Pick<Quote, 'lines' | 'problems'>): boolean {
  return !hasLineProblems(quote) && quote.problems.every((code) => CHECKOUT_STEP_PROBLEMS.has(code) || code.startsWith('promo.'));
}
