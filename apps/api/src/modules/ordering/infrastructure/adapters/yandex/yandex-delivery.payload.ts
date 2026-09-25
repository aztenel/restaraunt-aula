import { MINOR_UNITS_PER_MAJOR, Money } from '../../../../../shared/kernel/money';
import { CourierClaimInfo, CourierClaimRequest, CourierDispatchStatus } from '../../../domain/courier-dispatch';
import { formatMoney } from '../../../domain/order-texts';
import { YandexDeliverySettings } from './yandex-delivery.settings';

/** Построение запросов и разбор ответов Яндекс.Доставки (cargo claims v2). Чистые функции — под unit-тестами. */

/** Статусы заявки службы → статусы заявки у нас. Неизвестный статус — «идёт поиск» (опрос продолжается). */
const STATUS_MAP: Record<string, CourierDispatchStatus> = {
  new: 'estimating',
  estimating: 'estimating',
  estimating_failed: 'failed',
  ready_for_approval: 'awaiting_confirmation',
  accepted: 'searching',
  performer_lookup: 'searching',
  performer_draft: 'searching',
  performer_found: 'courier_assigned',
  pickup_arrived: 'courier_assigned',
  ready_for_pickup_confirmation: 'courier_assigned',
  performer_not_found: 'failed',
  pickuped: 'picked_up',
  delivery_arrived: 'picked_up',
  ready_for_delivery_confirmation: 'picked_up',
  pay_waiting: 'picked_up',
  delivered: 'delivered',
  delivered_finish: 'delivered',
  returning: 'failed',
  return_arrived: 'failed',
  ready_for_return_confirmation: 'failed',
  returned: 'failed',
  returned_finish: 'failed',
  failed: 'failed',
  cancelled: 'cancelled',
  cancelled_with_payment: 'cancelled',
  cancelled_by_taxi: 'cancelled',
  cancelled_with_items_on_hands: 'cancelled',
};

export function mapClaimStatus(status: string): CourierDispatchStatus {
  return STATUS_MAP[status] ?? 'searching';
}

/** Статусы, в которых у заявки есть курьер (запрашиваем телефон и ссылку отслеживания). */
export function hasPerformer(status: CourierDispatchStatus): boolean {
  return status === 'courier_assigned' || status === 'picked_up';
}

/** Сумма в тиынах → десятичная строка API: 150050 → "1500.50". Только целочисленная арифметика. */
export function minorToDecimal(money: Money): string {
  const sign = money.amount < 0 ? '-' : '';
  const abs = Math.abs(money.amount);
  return `${sign}${Math.floor(abs / MINOR_UNITS_PER_MAJOR)}.${String(abs % MINOR_UNITS_PER_MAJOR).padStart(2, '0')}`;
}

/** Десятичная строка API → тиыны ("350", "350.5", "350.50"); некорректное значение — null. Без float. */
export function decimalToMinor(value: unknown): Money | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  const m = /^(\d+)(?:[.,](\d{1,2})\d*)?$/.exec(text);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number((m[2] ?? '0').padEnd(2, '0'));
  return Money.of(major * MINOR_UNITS_PER_MAJOR + minor);
}

/** Координаты API — [долгота, широта]. */
function coordinates(p: { lat: number; lng: number }): [number, number] {
  return [p.lng, p.lat];
}

export function buildCreateClaimBody(request: CourierClaimRequest, settings: YandexDeliverySettings): Record<string, unknown> {
  const d = request.dropoff;
  const comment = [
    `Заказ ${request.orderNumber}`,
    request.collectOnDelivery ? `Оплата при получении: ${formatMoney(request.collectOnDelivery)}` : 'Заказ оплачен',
    request.contactless ? 'Бесконтактная доставка' : null,
    request.comment,
  ]
    .filter(Boolean)
    .join('. ');
  const body: Record<string, unknown> = {
    items: request.items.map((i) => ({
      pickup_point: 1,
      droppof_point: 2,
      title: i.title.slice(0, 200),
      cost_value: minorToDecimal(i.unitPrice),
      cost_currency: i.unitPrice.currency,
      quantity: i.quantity,
    })),
    route_points: [
      {
        point_id: 1,
        visit_order: 1,
        type: 'source',
        contact: { name: request.pickup.name, phone: request.pickup.phone },
        address: { fullname: request.pickup.address, coordinates: coordinates(request.pickup.location) },
        skip_confirmation: true,
      },
      {
        point_id: 2,
        visit_order: 2,
        type: 'destination',
        contact: { name: d.name ?? 'Гость', phone: d.phone },
        address: {
          fullname: d.address,
          coordinates: coordinates(d.location),
          ...(d.apartment ? { sflat: d.apartment } : {}),
          ...(d.entrance ? { porch: d.entrance } : {}),
          ...(d.floor ? { sfloor: d.floor } : {}),
          ...(d.intercom ? { door_code: d.intercom } : {}),
          ...(d.comment ? { comment: d.comment } : {}),
        },
        external_order_id: request.orderNumber,
        skip_confirmation: true,
      },
    ],
    client_requirements: { taxi_class: settings.taxiClass },
    emergency_contact: { name: settings.emergencyContactName, phone: settings.emergencyContactPhone ?? request.pickup.phone },
    comment,
    skip_door_to_door: request.contactless,
    optional_return: false,
    referral_source: 'aula',
  };
  if (request.dueAt) body.due = request.dueAt.toISOString();
  return body;
}

export interface ClaimResponse {
  id?: string;
  status?: string;
  version?: number;
  pricing?: { offer?: { price?: string | number }; final_price?: string | number; currency?: string };
  performer_info?: { courier_name?: string | null };
}

export function parseClaim(body: unknown): { id: string; status: string; version: number | null; info: CourierClaimInfo } {
  const claim = (body ?? {}) as ClaimResponse;
  if (!claim.id || !claim.status) {
    throw new Error('Unexpected claim response: id and status are required');
  }
  const status = mapClaimStatus(claim.status);
  return {
    id: claim.id,
    status: claim.status,
    version: typeof claim.version === 'number' ? claim.version : null,
    info: {
      externalId: claim.id,
      status,
      providerStatus: claim.status,
      trackingUrl: null,
      courierName: claim.performer_info?.courier_name?.trim() || null,
      courierPhone: null,
      price: decimalToMinor(claim.pricing?.final_price) ?? decimalToMinor(claim.pricing?.offer?.price),
    },
  };
}

/** Ссылка отслеживания для гостя: route_points[].sharing_link (точка доставки) или sharing_link. */
export function parseTrackingLink(body: unknown): string | null {
  const b = (body ?? {}) as { sharing_link?: unknown; route_points?: Array<{ sharing_link?: unknown; type?: string }> };
  const points = Array.isArray(b.route_points) ? b.route_points : [];
  const link = points.find((p) => p.type === 'destination')?.sharing_link ?? points.find((p) => p.sharing_link)?.sharing_link ?? b.sharing_link;
  return typeof link === 'string' && /^https?:\/\//.test(link) ? link : null;
}

/** Телефон курьера (переадресация): phone + добавочный. */
export function parseCourierPhone(body: unknown): string | null {
  const b = (body ?? {}) as { phone?: unknown; ext?: unknown };
  if (typeof b.phone !== 'string' || !b.phone.trim()) return null;
  return typeof b.ext === 'string' && b.ext.trim() ? `${b.phone.trim()} доб. ${b.ext.trim()}` : b.phone.trim();
}

/** Текст ошибки API ({ code, message }) для журнала. */
export function apiErrorMessage(body: unknown): string | null {
  const b = (body ?? {}) as { code?: unknown; message?: unknown };
  const parts = [b.code, b.message].filter((x): x is string => typeof x === 'string' && x.length > 0);
  return parts.length ? parts.join(': ') : null;
}
