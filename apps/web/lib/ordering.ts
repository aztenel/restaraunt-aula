/**
 * Расчёт корзины на сервере: POST /api/v1/public/orders/quote (модуль Ordering).
 * Витрина денег НЕ считает (правила ТЗ №6 и №8): названия, цены, скидка, доставка, итог,
 * доступность позиций и минимальная сумма — только из ответа.
 *
 * TODO(ordering/openapi): запрос идёт через api.raw() — эндпоинт делался параллельно с витриной.
 *   Он уже появился в docs/openapi.json (QuoteOrderDto → QuoteDto), тело запроса типизировано по схеме
 *   (QuoteOrderBody). Перейти на `call(api.POST('/api/v1/public/orders/quote', { body, params: { query: { locale } } }))`,
 *   когда nullable-поля DTO получат явные типы (сейчас promoCode и суммы/названия ответа выводятся как
 *   Record<string, never>), и заменить интерфейсы ответа ниже на components['schemas']['QuoteDto'],
 *   убрав normalizeQuote (разбор «на всякий случай»).
 */
import { ApiError, type ApiClient } from '@aula/api-client';
import type { Money, QuoteOrderBody } from './api-types';

export const QUOTE_PATH = '/api/v1/public/orders/quote';

export type OrderType = 'delivery' | 'pickup';
export const ORDER_TYPES: readonly OrderType[] = ['pickup', 'delivery'];

export interface QuoteItem {
  dishId: string;
  quantity: number;
  modifierOptionIds: string[];
}

/** Запрос расчёта (контракт Ordering). */
export interface QuoteRequest {
  branchId: string;
  type: OrderType;
  items: QuoteItem[];
  /** Точка доставки (выбирается при оформлении). */
  deliveryPoint?: { lat: number; lng: number } | null;
  promoCode?: string | null;
  certificateCode?: string | null;
  /** К определённому времени (ISO). */
  scheduledFor?: string | null;
  /** Телефон гостя — для лимита промокода на один телефон. */
  phone?: string | null;
}

export interface QuoteModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  name: string;
  price: Money;
}

export interface QuoteLine {
  /** Номер позиции в запросе (совпадает с порядком items). */
  index: number;
  dishId: string;
  /** null — блюдо не найдено в меню филиала. */
  name: string | null;
  photoUrl: string | null;
  quantity: number;
  unitPrice: Money | null;
  lineTotal: Money | null;
  modifiers: QuoteModifier[];
  available: boolean;
  /** Машинный код проблемы позиции: catalog.dish_unavailable, catalog.dish_not_in_branch_menu, catalog.modifier_invalid… */
  problem: string | null;
}

export interface QuotePromo {
  code: string;
  applied: boolean;
  /** promo.not_found, promo.expired, promo.min_subtotal… */
  reason: string | null;
  details: Record<string, unknown> | null;
  discount: Money;
  freeDelivery: boolean;
}

export interface QuoteDelivery {
  pointProvided: boolean;
  deliverable: boolean;
  zoneName: string | null;
  etaMinutes: number | null;
  minOrderAmount: Money | null;
  minOrderReached: boolean;
  minOrderShortfall: Money | null;
  freeDeliveryFrom: Money | null;
  amountToFreeDelivery: Money | null;
}

export interface QuoteCertificate {
  applied: boolean;
  reason: string | null;
  maskedCode: string | null;
  balance: Money | null;
  amount: Money | null;
}

export interface Quote {
  branchId: string;
  type: OrderType;
  lines: QuoteLine[];
  subtotal: Money;
  discount: Money;
  deliveryFee: Money;
  total: Money;
  /** К оплате (итог минус сертификат); если сервер не прислал — null. */
  amountDue: Money | null;
  delivery: QuoteDelivery | null;
  promo: QuotePromo | null;
  certificate: QuoteCertificate | null;
  /** Что мешает оформить (машинные коды). */
  problems: string[];
  canCheckout: boolean;
}

export type QuoteOutcome =
  | { kind: 'ok'; quote: Quote }
  /** Эндпоинт ещё не развёрнут (404 маршрута) — показываем позиции без сумм. */
  | { kind: 'unavailable' }
  | { kind: 'error'; error: ApiError };

/**
 * Тело запроса (QuoteOrderDto). API отклоняет лишние поля (forbidNonWhitelisted → 400), поэтому пустые
 * значения не отправляются. В DTO точка доставки называется `point`, а `scheduledFor` не принимается
 * (время проверяется при оформлении заказа) — в расчёт оно не передаётся.
 */
export function quoteBody(request: QuoteRequest): QuoteOrderBody {
  const body: QuoteOrderBody = {
    branchId: request.branchId,
    type: request.type,
    items: request.items.map(({ dishId, quantity, modifierOptionIds }) => ({ dishId, quantity, modifierOptionIds })),
  };
  if (request.deliveryPoint) body.point = { lat: request.deliveryPoint.lat, lng: request.deliveryPoint.lng };
  const promo = request.promoCode?.trim();
  if (promo) body.promoCode = promo;
  const certificate = request.certificateCode?.trim();
  if (certificate) body.certificateCode = certificate;
  const phone = request.phone?.trim();
  if (phone) body.phone = phone;
  return body;
}

// ---------------------------------------------------------------- Разбор ответа

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function money(value: unknown): Money | null {
  if (!isObject(value) || typeof value.amount !== 'number' || !Number.isFinite(value.amount)) return null;
  // Валюта одна (KZT) — сумма от сервера, витрина её только форматирует.
  return { amount: Math.trunc(value.amount), currency: 'KZT' };
}

const ZERO: Money = { amount: 0, currency: 'KZT' };

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function line(value: unknown, fallbackIndex: number): QuoteLine | null {
  if (!isObject(value) || typeof value.dishId !== 'string') return null;
  const problem = str(value.problem);
  return {
    index: typeof value.index === 'number' ? value.index : fallbackIndex,
    dishId: value.dishId,
    name: str(value.name),
    photoUrl: str(value.photoUrl),
    quantity: typeof value.quantity === 'number' ? value.quantity : 0,
    unitPrice: money(value.unitPrice),
    lineTotal: money(value.lineTotal),
    modifiers: Array.isArray(value.modifiers)
      ? value.modifiers.filter(isObject).map((m) => ({
          groupId: String(m.groupId ?? ''),
          groupName: String(m.groupName ?? ''),
          optionId: String(m.optionId ?? ''),
          name: String(m.name ?? ''),
          price: money(m.price) ?? ZERO,
        }))
      : [],
    available: value.available === undefined ? problem === null : value.available === true,
    problem,
  };
}

/** Ответ API → Quote; null — ответ не похож на расчёт. */
export function normalizeQuote(raw: unknown): Quote | null {
  if (!isObject(raw)) return null;
  const total = money(raw.total);
  if (!total || !Array.isArray(raw.lines)) return null;
  const lines = raw.lines.map(line).filter((l): l is QuoteLine => l !== null);
  const problems = Array.isArray(raw.problems) ? raw.problems.filter((p): p is string => typeof p === 'string') : [];
  const delivery = isObject(raw.delivery) ? raw.delivery : null;
  const promo = isObject(raw.promo) ? raw.promo : null;
  const certificate = isObject(raw.certificate) ? raw.certificate : null;
  return {
    branchId: String(raw.branchId ?? ''),
    type: raw.type === 'delivery' ? 'delivery' : 'pickup',
    lines,
    subtotal: money(raw.subtotal) ?? ZERO,
    discount: money(raw.discount) ?? ZERO,
    deliveryFee: money(raw.deliveryFee) ?? ZERO,
    total,
    amountDue: money(raw.amountDue),
    delivery: delivery
      ? {
          pointProvided: delivery.pointProvided === true,
          deliverable: delivery.deliverable === true,
          zoneName: str(delivery.zoneName),
          etaMinutes: typeof delivery.etaMinutes === 'number' ? delivery.etaMinutes : null,
          minOrderAmount: money(delivery.minOrderAmount),
          minOrderReached: delivery.minOrderReached !== false,
          minOrderShortfall: money(delivery.minOrderShortfall),
          freeDeliveryFrom: money(delivery.freeDeliveryFrom),
          amountToFreeDelivery: money(delivery.amountToFreeDelivery),
        }
      : null,
    promo: promo
      ? {
          code: String(promo.code ?? ''),
          applied: promo.applied === true,
          reason: str(promo.reason),
          details: isObject(promo.details) ? promo.details : null,
          discount: money(promo.discount) ?? ZERO,
          freeDelivery: promo.freeDelivery === true,
        }
      : null,
    certificate: certificate
      ? {
          applied: certificate.applied === true,
          reason: str(certificate.reason),
          maskedCode: str(certificate.maskedCode),
          balance: money(certificate.balance),
          amount: money(certificate.amount),
        }
      : null,
    problems,
    canCheckout: typeof raw.canCheckout === 'boolean' ? raw.canCheckout : problems.length === 0,
  };
}

/** Эндпоинт ещё не развёрнут: 404 без доменного кода (Nest отдаёт http.404 на неизвестный маршрут). */
export function isEndpointMissing(error: ApiError): boolean {
  return error.status === 404 && (error.code === 'http.404' || error.code === 'http.unknown');
}

export async function requestQuote(
  api: Pick<ApiClient, 'raw'>,
  request: QuoteRequest,
  options: { locale: string; signal?: AbortSignal },
): Promise<QuoteOutcome> {
  try {
    const raw = await api.raw<unknown>('POST', QUOTE_PATH, {
      body: quoteBody(request),
      query: { locale: options.locale },
      signal: options.signal,
    });
    const quote = normalizeQuote(raw);
    if (!quote) return { kind: 'error', error: new ApiError({ status: 200, code: 'quote.invalid_response', message: 'Unexpected quote response' }) };
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
export function hasLineProblems(quote: Quote): boolean {
  return quote.lines.some((l) => !l.available || l.problem !== null);
}

/** Можно ли перейти к оформлению из корзины: нет проблем, кроме тех, что решаются при оформлении. */
export function canProceedToCheckout(quote: Quote): boolean {
  return !hasLineProblems(quote) && quote.problems.every((code) => CHECKOUT_STEP_PROBLEMS.has(code) || code.startsWith('promo.'));
}
