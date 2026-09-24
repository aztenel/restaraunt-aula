import { PosFailureReason } from '../public';
import { describeMissing } from './order-lines';
import { MissingMapping } from './order-export';

/**
 * Тексты оповещений персонала о проблемах с POS (русский — язык админки).
 * Главное в каждом: заказ принят и продолжает обрабатываться, кухня работает по экрану админки.
 */
const KITCHEN_FALLBACK = 'Заказ принят и остаётся в работе — готовьте по экрану заказа в админке.';

export function exportFailureAlert(input: {
  orderNumber: string;
  reason: PosFailureReason;
  error: string;
  attempts: number;
  missing?: MissingMapping[];
  link?: string | null;
}): { title: string; details: string } {
  let what: string;
  switch (input.reason) {
    case 'missing_mapping':
      what = `Нет сопоставления с товарами POS: ${describeMissing(input.missing ?? []) || input.error}. Сопоставьте блюда в разделе «Интеграции → POS» и повторите передачу.`;
      break;
    case 'not_configured':
      what = `Интеграция POS филиала не настроена: ${input.error}.`;
      break;
    case 'rejected':
      what = `POS отклонила заказ: ${input.error}.`;
      break;
    case 'retries_exhausted':
      what = `POS недоступна, попыток передачи: ${input.attempts} (${input.error}). Повторите передачу, когда POS заработает.`;
      break;
    case 'order_unavailable':
      what = `Не удалось получить заказ для передачи: ${input.error}.`;
      break;
  }
  const details = [what, KITCHEN_FALLBACK, input.link ?? ''].filter((s) => s.length > 0).join('\n');
  return { title: `Заказ ${input.orderNumber} не передан в POS`, details };
}

export function cancelledAfterSentAlert(input: { orderNumber: string; posOrderId: string | null; link?: string | null }): {
  title: string;
  details: string;
} {
  const details = [
    `Заказ отменён, но уже передан в POS${input.posOrderId ? ` (№ в POS: ${input.posOrderId})` : ''}. Отмените его в POS вручную, чтобы кухня не готовила.`,
    input.link ?? '',
  ]
    .filter((s) => s.length > 0)
    .join('\n');
  return { title: `Заказ ${input.orderNumber} отменён — отмените в POS`, details };
}

export function unconfirmedOrderAlert(input: { orderNumber: string; posOrderId: string | null; link?: string | null }): {
  title: string;
  details: string;
} {
  const details = [
    `POS приняла заказ в обработку, но не подтвердила его создание${input.posOrderId ? ` (№ в POS: ${input.posOrderId})` : ''}.`,
    'Проверьте, появился ли заказ на кассе и кухне; если нет — готовьте по экрану заказа в админке.',
    input.link ?? '',
  ]
    .filter((s) => s.length > 0)
    .join('\n');
  return { title: `Заказ ${input.orderNumber} не подтверждён POS`, details };
}

export function stopListSyncAlert(input: { providerTitle: string; failures: number; error: string; link?: string | null }): {
  title: string;
  details: string;
} {
  const details = [
    `Не удаётся получить стоп-лист из POS (${input.providerTitle}), неудачных попыток подряд: ${input.failures}. Ошибка: ${input.error}.`,
    'Стоп-лист на сайте не обновляется автоматически — при необходимости ведите его вручную в админке.',
    input.link ?? '',
  ]
    .filter((s) => s.length > 0)
    .join('\n');
  return { title: 'Синхронизация стоп-листа с POS не работает', details };
}
