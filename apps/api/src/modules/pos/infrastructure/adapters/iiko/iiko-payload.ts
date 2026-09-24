import { Money } from '../../../../../shared/kernel/money';
import { zonedParts } from '../../../../../shared/kernel/time';
import { KitchenOrder } from '../../../../ordering/public';
import { PosOrderCheck, PosOrderMapping, PosProduct, PosProductKind, PosStopListItem } from '../../../domain/pos-client';
import { IikoBranchSettings } from './iiko.settings';

/**
 * Преобразования «наши данные <-> iikoCloud API» (чистые функции, тестируются без сети).
 * Документация: https://api-ru.iiko.services/ (deliveries/create, stop_lists, nomenclature).
 */
export interface IikoDeliveryItem {
  productId: string;
  amount: number;
  type: 'Product';
  modifiers: Array<{ productId: string; amount: number; productGroupId?: string }>;
}

export interface IikoDeliveryRequest {
  organizationId: string;
  terminalGroupId?: string;
  order: {
    /** Наш id заказа: повторная отправка после таймаута не создаст второй заказ в iiko. */
    id: string;
    externalNumber: string;
    completeBefore?: string;
    phone: string;
    orderServiceType: 'DeliveryByCourier' | 'DeliveryByClient';
    deliveryPoint?: { comment: string };
    comment: string;
    customer: { name: string };
    items: IikoDeliveryItem[];
  };
}

const COMMENT_MAX_LENGTH = 1000;
const GUEST_NAME = 'Гость';

/** Время в формате iiko «yyyy-MM-dd HH:mm:ss.fff» в часовом поясе точки. */
export function formatIikoDateTime(iso: string, timezone: string): string {
  const p = zonedParts(new Date(iso), timezone);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}.000`;
}

export function buildOrderComment(order: KitchenOrder): string {
  const lines = [`Заказ ${order.number} (сайт)`];
  lines.push(order.isPaidOnline ? 'Оплачен онлайн' : `Оплата при получении: ${Money.fromJson(order.total).toString()}`);
  if (order.type === 'delivery' && order.deliveryAddress) lines.push(`Адрес: ${order.deliveryAddress}`);
  if (order.comment?.trim()) lines.push(`Комментарий гостя: ${order.comment.trim()}`);
  const text = lines.join('\n');
  return text.length > COMMENT_MAX_LENGTH ? `${text.slice(0, COMMENT_MAX_LENGTH - 1)}…` : text;
}

export function buildDeliveryRequest(order: KitchenOrder, mapping: PosOrderMapping, branch: IikoBranchSettings): IikoDeliveryRequest {
  const isDelivery = order.type === 'delivery';
  return {
    organizationId: branch.organizationId,
    ...(branch.terminalGroupId ? { terminalGroupId: branch.terminalGroupId } : {}),
    order: {
      id: order.orderId,
      externalNumber: order.number,
      ...(order.scheduledFor ? { completeBefore: formatIikoDateTime(order.scheduledFor, mapping.timezone) } : {}),
      phone: order.customer.phone,
      orderServiceType: isDelivery ? 'DeliveryByCourier' : 'DeliveryByClient',
      ...(isDelivery ? { deliveryPoint: { comment: order.deliveryAddress ?? '' } } : {}),
      comment: buildOrderComment(order),
      customer: { name: order.customer.name?.trim() || GUEST_NAME },
      items: mapping.lines.map((line) => ({
        productId: line.externalProductId,
        amount: line.quantity,
        type: 'Product' as const,
        modifiers: line.modifiers.map((m) => ({
          productId: m.externalProductId,
          amount: m.amount,
          ...(m.externalGroupId ? { productGroupId: m.externalGroupId } : {}),
        })),
      })),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Текст ошибки из ответа iiko ({ errorDescription, error, description, message }). */
export function iikoErrorMessage(body: unknown): string | null {
  const r = asRecord(body);
  if (!r) return typeof body === 'string' && body.trim() ? body.trim().slice(0, 500) : null;
  for (const key of ['errorDescription', 'description', 'message', 'error']) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 500);
  }
  return null;
}

/** Ответ deliveries/create: id заказа в iiko и статус создания. */
export function parseCreateDeliveryResponse(body: unknown): { posOrderId: string | null; creationStatus: string | null; error: string | null } {
  const info = asRecord(asRecord(body)?.orderInfo);
  const errorInfo = asRecord(info?.errorInfo);
  const error = errorInfo ? (iikoErrorMessage(errorInfo) ?? (typeof errorInfo.code === 'string' ? errorInfo.code : 'Error')) : null;
  return {
    posOrderId: typeof info?.id === 'string' && info.id ? info.id : null,
    creationStatus: typeof info?.creationStatus === 'string' ? info.creationStatus : null,
    error,
  };
}

/**
 * Ответ deliveries/by_id: состояние асинхронного создания заказа.
 * Success — создан на кассе; Error — отклонён (errorInfo); InProgress или заказа ещё нет в ответе — ждать.
 */
export function parseDeliveryById(body: unknown, posOrderId: string): PosOrderCheck {
  const order = asArray(asRecord(body)?.orders)
    .map(asRecord)
    .find((o) => o?.id === posOrderId);
  if (!order) return { state: 'in_progress' };
  if (order.creationStatus === 'Success') return { state: 'created' };
  if (order.creationStatus === 'Error') {
    const errorInfo = asRecord(order.errorInfo);
    return { state: 'failed', error: (errorInfo && iikoErrorMessage(errorInfo)) ?? (typeof errorInfo?.code === 'string' ? errorInfo.code : 'Order creation failed') };
  }
  return { state: 'in_progress' };
}

/**
 * Ответ stop_lists: позиции стоп-листа организации (по группе терминалов точки, если задана).
 * balance <= 0 — товар закончился (недоступен), balance > 0 — ограниченный остаток (доступен).
 */
export function parseStopLists(body: unknown, branch: IikoBranchSettings): PosStopListItem[] {
  const result: PosStopListItem[] = [];
  for (const org of asArray(asRecord(body)?.terminalGroupStopLists)) {
    const o = asRecord(org);
    if (!o || (typeof o.organizationId === 'string' && o.organizationId !== branch.organizationId)) continue;
    for (const group of asArray(o.items)) {
      const g = asRecord(group);
      if (!g) continue;
      if (branch.terminalGroupId && typeof g.terminalGroupId === 'string' && g.terminalGroupId !== branch.terminalGroupId) continue;
      for (const item of asArray(g.items)) {
        const i = asRecord(item);
        if (!i || typeof i.productId !== 'string' || !i.productId) continue;
        const balance = typeof i.balance === 'number' ? i.balance : 0;
        result.push({ externalProductId: i.productId, available: balance > 0 });
      }
    }
  }
  return result;
}

const KIND_BY_TYPE: Record<string, PosProductKind> = {
  dish: 'dish',
  good: 'good',
  modifier: 'modifier',
  service: 'service',
};

/** Ответ nomenclature: товары (без удалённых) с названием группы. */
export function parseNomenclature(body: unknown): PosProduct[] {
  const r = asRecord(body);
  const groups = new Map<string, string>();
  for (const group of asArray(r?.groups)) {
    const g = asRecord(group);
    if (g && typeof g.id === 'string' && typeof g.name === 'string') groups.set(g.id, g.name);
  }
  const products: PosProduct[] = [];
  for (const product of asArray(r?.products)) {
    const p = asRecord(product);
    if (!p || p.isDeleted === true || typeof p.id !== 'string' || !p.id) continue;
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : p.id;
    const code = typeof p.code === 'string' && p.code.trim() ? p.code.trim() : null;
    const parent = typeof p.parentGroup === 'string' ? p.parentGroup : null;
    products.push({
      externalProductId: p.id,
      name: name.slice(0, 300),
      sku: code,
      kind: KIND_BY_TYPE[String(p.type ?? '').toLowerCase()] ?? 'other',
      groupName: parent ? (groups.get(parent) ?? null) : null,
    });
  }
  return products;
}
