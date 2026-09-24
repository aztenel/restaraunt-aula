import { ValidationError } from '../../../shared/kernel/errors';
import { isUuid } from '../../../shared/kernel/ids';
import { isEnumValue } from '../../../shared/kernel/state-machine';

/**
 * Аналитика витрины: анонимные события сессии без персональных данных.
 * Конверсия = сессии с оформленным заказом (OrderPlaced.analyticsSessionId) / сессии витрины.
 */
export const StorefrontEventType = {
  PageView: 'page_view',
  MenuView: 'menu_view',
  DishView: 'dish_view',
  AddToCart: 'add_to_cart',
  CheckoutStart: 'checkout_start',
} as const;
export type StorefrontEventType = (typeof StorefrontEventType)[keyof typeof StorefrontEventType];
export const STOREFRONT_EVENT_TYPES = Object.values(StorefrontEventType);

/** Сколько хранить сырые события витрины, дней. */
export const STOREFRONT_RETENTION_DAYS = 400;

export const MAX_PATH_LENGTH = 300;

const UUID_SEGMENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Публичные токены ссылок (заказ, смета, бронь): длинные base64url-строки со смесью букв и цифр.
const TOKEN_SEGMENT_RE = /^[A-Za-z0-9_-]{16,}$/;
const DIGITS_RE = /\d{5,}/g;

function looksLikeToken(segment: string): boolean {
  return TOKEN_SEGMENT_RE.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment) && !segment.includes('-');
}

/**
 * Путь без персональных данных и секретов: без query и fragment, идентификаторы и токены
 * заменены на ':id', длинные числа (телефоны, номера) — на ':n'.
 */
export function sanitizePath(raw: string): string {
  let path = raw.trim();
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    throw new ValidationError('analytics.invalid_path', 'Invalid path');
  }
  path = path.split(/[?#]/)[0] ?? '';
  if (!path.startsWith('/')) path = `/${path}`;
  const segments = path.split('/').map((segment) => {
    if (!segment) return segment;
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      decoded = segment;
    }
    if (UUID_SEGMENT_RE.test(decoded) || looksLikeToken(decoded)) return ':id';
    return decoded.replace(DIGITS_RE, ':n');
  });
  const result = segments.join('/').replace(/\/{2,}/g, '/');
  return result.slice(0, MAX_PATH_LENGTH);
}

export interface StorefrontEventInput {
  sessionId: string;
  type: string;
  branchId?: string | null;
  path: string;
}

export interface StorefrontEvent {
  sessionId: string;
  type: StorefrontEventType;
  branchId: string | null;
  path: string;
}

/** Проверка и нормализация входящего события. */
export function normalizeStorefrontEvent(input: StorefrontEventInput): StorefrontEvent {
  if (!isUuid(input.sessionId)) throw new ValidationError('analytics.invalid_session', 'sessionId must be a UUID');
  if (!isEnumValue(StorefrontEventType, input.type)) {
    throw new ValidationError('analytics.invalid_type', 'Unknown event type', { type: input.type });
  }
  if (input.branchId && !isUuid(input.branchId)) throw new ValidationError('analytics.invalid_branch', 'branchId must be a UUID');
  if (typeof input.path !== 'string' || input.path.length === 0 || input.path.length > 2000) {
    throw new ValidationError('analytics.invalid_path', 'Invalid path');
  }
  return {
    sessionId: input.sessionId.toLowerCase(),
    type: input.type,
    branchId: input.branchId ?? null,
    path: sanitizePath(input.path),
  };
}
