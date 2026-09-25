/**
 * Телефонный заказ: корзина (только id блюд, опций и количества), запросы расчёта и оформления.
 * Денег здесь нет — цены, скидки, доставку и итог считает сервер (POST /admin/orders/quote).
 */
import type { GeoPoint } from '@aula/api-client';
import type {
  AdminCreateOrderInput,
  CheckoutPaymentMethod,
  OrderQuote,
  OrderType,
  PublicModifierGroup,
  QuoteOrderInput,
} from '../types';

export const MAX_LINE_QUANTITY = 99;
export const MAX_CART_LINES = 50;

export interface CartLine {
  /** Блюдо + набор опций: одинаковые позиции объединяются. */
  key: string;
  dishId: string;
  dishSlug: string;
  /** Название из меню витрины (для списка до ответа сервера). */
  name: string;
  quantity: number;
  modifierOptionIds: string[];
  /** Подписи выбранных опций для оператора. */
  modifierLabels: string[];
}

export function cartLineKey(dishId: string, optionIds: readonly string[]): string {
  return `${dishId}:${[...optionIds].sort().join(',')}`;
}

function clampQuantity(quantity: number): number {
  return Math.min(MAX_LINE_QUANTITY, Math.max(0, Math.trunc(quantity)));
}

/** Добавить позицию; такая же (блюдо + опции) — увеличить количество. */
export function addLine(cart: readonly CartLine[], line: Omit<CartLine, 'key'>): CartLine[] {
  const key = cartLineKey(line.dishId, line.modifierOptionIds);
  const existing = cart.find((l) => l.key === key);
  if (existing) return cart.map((l) => (l.key === key ? { ...l, quantity: clampQuantity(l.quantity + line.quantity) } : l));
  if (cart.length >= MAX_CART_LINES) return [...cart];
  return [...cart, { ...line, key, quantity: clampQuantity(line.quantity) || 1 }];
}

/** Количество 0 и меньше — позиция убирается. */
export function setLineQuantity(cart: readonly CartLine[], key: string, quantity: number): CartLine[] {
  const next = clampQuantity(quantity);
  return next === 0 ? cart.filter((l) => l.key !== key) : cart.map((l) => (l.key === key ? { ...l, quantity: next } : l));
}

export function removeLine(cart: readonly CartLine[], key: string): CartLine[] {
  return cart.filter((l) => l.key !== key);
}

/** Телефон к виду +7XXXXXXXXXX (8XXXXXXXXXX, 7XXXXXXXXXX, пробелы и скобки допустимы). Сервер нормализует сам. */
export function normalizePhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return raw.trim();
}

export function isPhoneComplete(raw: string): boolean {
  return /^\+7\d{10}$/.test(normalizePhoneInput(raw));
}

export interface PhoneOrderDraft {
  branchId: string;
  type: OrderType;
  cart: readonly CartLine[];
  point: GeoPoint | null;
  promoCode: string;
  certificateCode: string;
  phone: string;
}

/** Тело POST /admin/orders/quote; пустая корзина — не запрашиваем. */
export function buildQuoteInput(draft: PhoneOrderDraft): QuoteOrderInput | null {
  if (draft.cart.length === 0) return null;
  return {
    branchId: draft.branchId,
    type: draft.type,
    items: draft.cart.map((l) => ({ dishId: l.dishId, quantity: l.quantity, modifierOptionIds: [...l.modifierOptionIds] })),
    point: draft.type === 'delivery' ? draft.point : null,
    promoCode: draft.promoCode.trim() || null,
    certificateCode: draft.certificateCode.trim() || null,
    phone: isPhoneComplete(draft.phone) ? normalizePhoneInput(draft.phone) : null,
  };
}

export interface PhoneOrderDetails {
  name: string;
  email: string;
  addressText: string;
  apartment: string;
  entrance: string;
  floor: string;
  intercom: string;
  courierComment: string;
  contactless: boolean;
  comment: string;
  paymentMethod: CheckoutPaymentMethod;
  /** null — как можно скорее. */
  scheduledFor: string | null;
  consent: boolean;
  marketing: boolean;
  locale: 'kk' | 'ru' | 'en';
}

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Тело POST /admin/orders (телефонный заказ, канал admin). */
export function buildCreateInput(draft: PhoneOrderDraft, details: PhoneOrderDetails, idempotencyKey: string): AdminCreateOrderInput {
  const quote = buildQuoteInput(draft);
  return {
    branchId: draft.branchId,
    type: draft.type,
    items: quote?.items ?? [],
    delivery:
      draft.type === 'delivery' && draft.point
        ? {
            point: draft.point,
            addressText: details.addressText.trim(),
            apartment: optional(details.apartment),
            entrance: optional(details.entrance),
            floor: optional(details.floor),
            intercom: optional(details.intercom),
            courierComment: optional(details.courierComment),
          }
        : null,
    contactless: draft.type === 'delivery' ? details.contactless : false,
    scheduledFor: details.scheduledFor,
    customer: { name: details.name.trim(), phone: normalizePhoneInput(draft.phone), email: optional(details.email) },
    comment: optional(details.comment),
    promoCode: optional(draft.promoCode),
    certificateCode: optional(draft.certificateCode),
    paymentMethod: details.paymentMethod,
    consent: { personalData: details.consent, marketing: details.marketing ? true : null },
    locale: details.locale,
    idempotencyKey,
  };
}

export type CheckoutCheck = 'items' | 'phone' | 'name' | 'address' | 'slot' | 'consent' | 'quote';

/**
 * Что ещё не заполнено оператором (подсказки у кнопки «Оформить»). Бизнес-проблемы заказа
 * (минимальная сумма, зона, промокод, стоп-лист) — из quote.problems сервера.
 */
export function checkoutChecks(
  draft: PhoneOrderDraft,
  details: Pick<PhoneOrderDetails, 'name' | 'addressText' | 'consent' | 'scheduledFor'> & { scheduled: boolean },
  quote: OrderQuote | undefined,
): CheckoutCheck[] {
  const checks: CheckoutCheck[] = [];
  if (draft.cart.length === 0) checks.push('items');
  if (!isPhoneComplete(draft.phone)) checks.push('phone');
  if (!details.name.trim()) checks.push('name');
  if (draft.type === 'delivery' && (!draft.point || details.addressText.trim().length < 3)) checks.push('address');
  if (details.scheduled && !details.scheduledFor) checks.push('slot');
  if (!details.consent) checks.push('consent');
  if (draft.cart.length > 0 && !quote) checks.push('quote');
  return checks;
}

// ---------------------------------------------------------------- Модификаторы

export type ModifierSelection = Record<string, string[]>;
export type ModifierIssue = 'too_few' | 'too_many';

/** Опции по умолчанию (как на витрине). */
export function defaultModifierSelection(groups: readonly PublicModifierGroup[]): ModifierSelection {
  return Object.fromEntries(groups.map((g) => [g.id, g.options.filter((o) => o.isDefault).slice(0, g.maxSelect).map((o) => o.id)]));
}

/** Границы выбора в группе (minSelect/maxSelect из меню). Окончательно выбор проверяет сервер. */
export function modifierIssues(groups: readonly PublicModifierGroup[], selection: ModifierSelection): Record<string, ModifierIssue> {
  const issues: Record<string, ModifierIssue> = {};
  for (const group of groups) {
    const count = selection[group.id]?.length ?? 0;
    const min = Math.max(group.minSelect, group.isRequired ? 1 : 0);
    if (count < min) issues[group.id] = 'too_few';
    else if (count > group.maxSelect) issues[group.id] = 'too_many';
  }
  return issues;
}

/** Выбранные опции в порядке групп и подписи «Группа: опция». */
export function selectedOptions(
  groups: readonly PublicModifierGroup[],
  selection: ModifierSelection,
): { optionIds: string[]; labels: string[] } {
  const optionIds: string[] = [];
  const labels: string[] = [];
  for (const group of groups) {
    for (const option of group.options) {
      if (selection[group.id]?.includes(option.id)) {
        optionIds.push(option.id);
        labels.push(option.name);
      }
    }
  }
  return { optionIds, labels };
}

/** Новый ключ идемпотентности оформления (повтор запроса вернёт тот же заказ). */
export function newIdempotencyKey(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return `admin-${cryptoApi.randomUUID()}`;
  return `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
