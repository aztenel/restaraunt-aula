/**
 * Обращения теста к API напрямую: поиск демо-данных (меню, зоны, залы), подготовка сущностей для
 * страниц по токену, действия менеджера в админ-API (смета, счёт) и код SMS из журнала API.
 * Суммы здесь не считаются — только берутся из ответов сервера.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  Availability,
  BanquetRequestCreated,
  BranchMenu,
  CheckoutResult,
  DeliveryZone,
  DishCard,
  HallMap,
  OrderTracking,
  Reservation,
} from '../../lib/api-types';
import { API_LOG, API_URL, OWNER } from './env';
import { guestIp, localDate, type Guest } from './guest';

export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message: string,
  ) {
    super(message);
  }
}

/** Запрос к API от имени «гостя» с собственным IP (X-Forwarded-For; TRUST_PROXY=true — как за reverse proxy). */
export async function api<T>(path: string, init: { method?: string; body?: unknown; token?: string; ip?: string } = {}): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': init.ip ?? guestIp(),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new ApiCallError(res.status, text, `${init.method ?? (init.body === undefined ? 'GET' : 'POST')} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------------------------------------------------------------- Справочники витрины

export interface BranchInfo {
  id: string;
  slug: string;
  name: string;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  acceptsReservations: boolean;
  paymentMethods: string[];
}

export async function branch(slug: string): Promise<BranchInfo> {
  const all = await api<Array<BranchInfo & { name: Record<string, string> }>>('/public/branches');
  const found = all.find((b) => b.slug === slug);
  if (!found) throw new Error(`Branch ${slug} not found — is the demo seed (SEED_DEMO=true) loaded?`);
  return { ...found, name: found.name.ru ?? found.slug };
}

export interface PickedDish {
  id: string;
  slug: string;
  name: string;
  categorySlug: string;
  categoryName: string;
  price: number;
}

/** Доступное блюдо без обязательных добавок (из меню филиала). */
export async function pickDish(branchSlug: string, options: { skip?: number } = {}): Promise<PickedDish> {
  const menu = await api<BranchMenu>(`/public/catalog/branches/${branchSlug}/menu?locale=ru`);
  const candidates: PickedDish[] = [];
  for (const category of menu.categories) {
    for (const dish of category.dishes as DishCard[]) {
      if (dish.availability !== 'available' || dish.hasRequiredModifiers) continue;
      candidates.push({ id: dish.id, slug: dish.slug, name: dish.name, categorySlug: category.slug, categoryName: category.name, price: dish.price.amount });
    }
  }
  const dish = candidates[(options.skip ?? 0) % Math.max(candidates.length, 1)];
  if (!dish) throw new Error(`No simple available dish in ${branchSlug} menu`);
  return dish;
}

export function deliveryZones(branchId: string): Promise<DeliveryZone[]> {
  return api<DeliveryZone[]>(`/public/branches/${branchId}/delivery-zones?locale=ru`);
}

/** Место с депозитом, которое бронируется онлайн (VIP-зал или юрта). */
export async function depositVenue(branchSlug: string) {
  const map = await api<HallMap>(`/public/branches/${branchSlug}/halls?locale=ru`);
  const venue = map.halls.flatMap((h) => h.venues).find((v) => v.bookableOnline && v.deposit && v.deposit.amount > 0);
  if (!venue) throw new Error(`No online-bookable venue with a deposit in ${branchSlug}`);
  return venue;
}

// ---------------------------------------------------------------- Сущности для страниц по токену

/** Заказ на самовывоз с онлайн-оплатой (не оплачен) — для проверок страницы заказа. */
export async function createPickupOrder(guest: Guest, branchSlug: string): Promise<CheckoutResult> {
  const b = await branch(branchSlug);
  const dish = await pickDish(branchSlug);
  return api<CheckoutResult>('/public/orders', {
    ip: guest.ip,
    body: {
      branchId: b.id,
      type: 'pickup',
      items: [{ dishId: dish.id, quantity: 1, modifierOptionIds: [] }],
      customer: { name: guest.name, phone: guest.phone },
      paymentMethod: 'online',
      consent: { personalData: true },
      locale: 'ru',
      idempotencyKey: randomUUID(),
    },
  });
}

export function orderTracking(token: string): Promise<OrderTracking> {
  return api<OrderTracking>(`/public/orders/${token}?locale=ru`);
}

/** Бронь стола без депозита на свободную дату (поиск по датам вперёд). */
export async function createTableReservation(guest: Guest, branchSlug: string): Promise<Reservation> {
  const b = await branch(branchSlug);
  for (let offset = 5; offset < 60; offset += 3) {
    const date = localDate(offset);
    const availability = await api<Availability>(
      `/public/branches/${branchSlug}/reservation-availability?date=${date}&time=13:00&guests=2&locale=ru`,
      { ip: guest.ip },
    );
    const venue = availability.venues.find((v) => !v.deposit);
    if (!venue) continue;
    return api<Reservation>('/public/reservations', {
      ip: guest.ip,
      body: {
        branchId: b.id,
        venueId: venue.venueId,
        date,
        time: '13:00',
        guests: 2,
        customer: { name: guest.name, phone: guest.phone },
        consent: { personalData: true },
        locale: 'ru',
        idempotencyKey: randomUUID(),
      },
    });
  }
  throw new Error(`No free table without a deposit in ${branchSlug}`);
}

export function reservation(token: string): Promise<Reservation> {
  return api<Reservation>(`/public/reservations/${token}?locale=ru`);
}

// ---------------------------------------------------------------- Админ-API (менеджер банкетов)

let ownerToken: Promise<string> | null = null;

/** Токен собственника: POST /admin/auth/login с паролем из сида (SEED_OWNER_PASSWORD). */
export function ownerAccessToken(): Promise<string> {
  if (!OWNER.password) throw new Error('E2E_OWNER_PASSWORD (or SEED_OWNER_PASSWORD) is not set — see e2e/stack.md');
  ownerToken ??= api<{ accessToken: string }>('/admin/auth/login', { body: { email: OWNER.email, password: OWNER.password } }).then((r) => r.accessToken);
  return ownerToken;
}

/** Смета по заявке: позиции → сохранить версию → отправить клиенту. Возвращает токен публичной страницы. */
export async function sendBanquetQuote(requestNumber: string): Promise<{ requestId: string; token: string; url: string }> {
  const token = await ownerAccessToken();
  const list = await api<{ items: Array<{ id: string; number: string }> }>(`/admin/banquets/requests?q=${encodeURIComponent(requestNumber)}`, { token });
  const request = list.items.find((r) => r.number === requestNumber);
  if (!request) throw new Error(`Banquet request ${requestNumber} not found in admin API`);
  const quote = await api<{ id: string }>(`/admin/banquets/requests/${request.id}/quotes`, {
    token,
    body: {
      lines: [
        { kind: 'other', title: { ru: 'Банкетное меню (на гостя)' }, unit: 'чел.', unitPrice: { amount: 1_500_000 }, quantity: 40 },
        { kind: 'hall_rent', title: { ru: 'Аренда зала' }, unit: 'усл.', unitPrice: { amount: 20_000_000 }, quantity: 1 },
      ],
      serviceChargeBp: 1000,
    },
  });
  const sent = await api<{ publicQuoteUrl: string }>(`/admin/banquets/quotes/${quote.id}/send`, { token, method: 'POST' });
  return { requestId: request.id, url: sent.publicQuoteUrl, token: tokenFromUrl(sent.publicQuoteUrl) };
}

/** Счёт физлицу на предоплату (после согласования сметы). */
export async function issueIndividualInvoice(requestId: string): Promise<{ token: string; url: string }> {
  const token = await ownerAccessToken();
  const invoice = await api<{ publicUrl: string }>(`/admin/banquets/requests/${requestId}/invoices`, { token, body: { payerType: 'individual' } });
  return { url: invoice.publicUrl, token: tokenFromUrl(invoice.publicUrl) };
}

export function tokenFromUrl(url: string): string {
  return new URL(url).pathname.split('/').filter(Boolean).pop()!;
}

export type { BanquetRequestCreated };

// ---------------------------------------------------------------- Код SMS

/**
 * Код подтверждения из журнала API. В dev/стендах SMS уходят в канал «log» (NotificationsLogChannel):
 * он пишет текст целиком: «[sms -> log] AULA: код 1234 …» с маской получателя «+7 707 *** ** 34».
 * В БД и журнале доставок админки код замаскирован, поэтому это единственный источник без бэкдоров.
 */
export async function waitForSmsCode(phone: string, options: { after: number; timeoutMs?: number } = { after: 0 }): Promise<string> {
  if (!API_LOG) throw new Error('E2E_API_LOG is not set — start the API with stdout redirected to a file (see e2e/stack.md)');
  const digits = phone.replace(/\D/g, '');
  const masked = `+7 ${digits.slice(1, 4)} *** ** ${digits.slice(9, 11)}`;
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    const log = readFileSync(API_LOG).subarray(options.after).toString('utf8');
    const lines = log.split('\n').filter((line) => line.includes('-> log]') && line.includes(masked) && line.includes('otp.code'));
    const match = lines.at(-1)?.match(/-> log\][^\d]*(\d{4,8})/);
    if (match?.[1]) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No SMS code for ${masked} in ${API_LOG}`);
}

/** Текущий размер журнала — чтобы искать код только в новых строках. */
export function apiLogSize(): number {
  if (!API_LOG) return 0;
  try {
    return readFileSync(API_LOG).length;
  } catch {
    return 0;
  }
}
