/**
 * Возврат гостя со страницы платёжного провайдера: /[locale]/payment/return?type=…&token=…
 * Параметры адреса НИЧЕГО не подтверждают (оплату подтверждает сервер по вебхуку/опросу) —
 * они только выбирают страницу статуса, которая сама спросит API. Путь строится из
 * фиксированного набора маршрутов витрины (не открытый редирект).
 */
import { routes } from './routes';

export type PaymentReturnKind = 'order' | 'certificate' | 'booking' | 'banquet_invoice';

/** Синонимы: назначения платежа в API (purpose) и короткие имена. */
const KIND_ALIASES: Record<string, PaymentReturnKind> = {
  order: 'order',
  orders: 'order',
  certificate: 'certificate',
  certificates: 'certificate',
  gift_certificate: 'certificate',
  booking: 'booking',
  reservation: 'booking',
  reservations: 'booking',
  reservation_deposit: 'booking',
  banquet_invoice: 'banquet_invoice',
  banquet: 'banquet_invoice',
  invoice: 'banquet_invoice',
};

/** Публичные токены API — base64url (randomToken). */
const TOKEN_RE = /^[A-Za-z0-9_-]{8,200}$/;

export function resolvePaymentReturnKind(type: string | null | undefined): PaymentReturnKind | null {
  if (!type) return null;
  return KIND_ALIASES[type.trim().toLowerCase()] ?? null;
}

export function isPublicToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

/** Страница статуса (путь без языка) или null — параметры не распознаны. */
export function paymentReturnPath(type: string | null | undefined, token: string | null | undefined): string | null {
  const kind = resolvePaymentReturnKind(type);
  if (!kind || !isPublicToken(token)) return null;
  switch (kind) {
    case 'order':
      return routes.order(token);
    case 'certificate':
      return routes.certificateOrder(token);
    case 'booking':
      return routes.bookingStatus(token);
    case 'banquet_invoice':
      return routes.banquetInvoice(token);
  }
}
