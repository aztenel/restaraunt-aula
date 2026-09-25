/**
 * Общий сценарий онлайн-оплаты (заказ, депозит брони, счёт банкета, сертификат): ссылку на оплату
 * создаёт задача в очереди, витрина опрашивает статус и ОДИН раз автоматически переводит гостя
 * на страницу оплаты — только сразу после оформления (?pay=1). Вернувшегося с оплаты гостя
 * обратно не отправляем: оплату подтверждает сервер (вебхук/опрос провайдера).
 */

/** Переход на оплату только по http(s)-ссылке от API. */
export function isSafePaymentUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url, 'https://placeholder.invalid');
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Флаг в sessionStorage/localStorage (приватный режим — без флага, но без ошибки). */
export function storageFlag(storage: 'local' | 'session', key: string, set = false): boolean {
  try {
    const target = storage === 'local' ? window.localStorage : window.sessionStorage;
    if (set) target.setItem(key, '1');
    return target.getItem(key) === '1';
  } catch {
    return false;
  }
}

export type PaymentScope = 'order' | 'booking' | 'banquet_invoice' | 'certificate';

export function redirectFlagKey(scope: PaymentScope, token: string, attempt: string | null = null): string {
  return `aula_pay:${scope}:${token}${attempt ? `:${attempt}` : ''}`;
}

/**
 * Перенаправить на оплату сейчас? Да — если гость только что оформил (или нажал «Оплатить»),
 * ссылка готова и по этой попытке оплаты ещё не переходили.
 */
export function shouldAutoRedirect(input: { autoPay: boolean; paymentUrl: string | null | undefined; alreadyRedirected: boolean }): boolean {
  return input.autoPay && !input.alreadyRedirected && isSafePaymentUrl(input.paymentUrl);
}

/** Цель аналитики «покупка» — один раз на объект (localStorage), даже при повторном открытии ссылки. */
export function reachGoalOnce(key: string, fire: () => void): void {
  if (storageFlag('local', key)) return;
  storageFlag('local', key, true);
  fire();
}

/** Переход на страницу оплаты провайдера (отдельная функция — подменяется в тестах). */
export function goToPayment(url: string): void {
  window.location.assign(url);
}
