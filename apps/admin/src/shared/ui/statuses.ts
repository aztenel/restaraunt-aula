/**
 * Статусы доменных автоматов (словарь из public-контрактов модулей API) → цвет тега AntD.
 * Подписи — i18n: statuses.<domain>.<status>. Переходы статусов фронт НЕ вычисляет:
 * доступные действия приходят с сервера (allowedTransitions).
 */
export const STATUS_COLORS = {
  order: {
    draft: 'default',
    awaiting_payment: 'gold',
    paid: 'cyan',
    accepted: 'blue',
    cooking: 'geekblue',
    ready: 'purple',
    delivering: 'processing',
    completed: 'success',
    cancelled: 'error',
    refunded: 'magenta',
  },
  reservation: {
    pending: 'gold',
    awaiting_deposit: 'orange',
    confirmed: 'blue',
    arrived: 'success',
    no_show: 'volcano',
    cancelled: 'error',
    expired: 'default',
  },
  banquet: {
    new: 'red',
    in_progress: 'blue',
    quote_sent: 'geekblue',
    agreed: 'cyan',
    prepaid: 'purple',
    held: 'success',
    cancelled: 'default',
  },
  payment: {
    created: 'default',
    pending: 'gold',
    succeeded: 'success',
    failed: 'error',
    cancelled: 'default',
    partially_refunded: 'orange',
    refunded: 'magenta',
  },
  certificate: {
    active: 'success',
    redeemed: 'default',
    expired: 'orange',
    blocked: 'error',
  },
  job: {
    open: 'error',
    retried: 'processing',
    resolved: 'success',
  },
} as const satisfies Record<string, Record<string, string>>;

export type StatusDomain = keyof typeof STATUS_COLORS;

export function statusColor(domain: StatusDomain, status: string): string {
  return (STATUS_COLORS[domain] as Record<string, string>)[status] ?? 'default';
}
