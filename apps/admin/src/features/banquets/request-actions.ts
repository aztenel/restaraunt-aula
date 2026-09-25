/**
 * Кнопки воронки банкетной заявки — только из того, что разрешил сервер (allowedTransitions).
 * Фронт не знает автомата статусов и его условий (есть ли смета, отправлена ли она, покрыта ли
 * предоплата, наступила ли дата): он лишь сопоставляет разрешённый переход с кнопкой и подписью.
 *
 * Подсказки видимости второстепенных кнопок (новая версия сметы, счёт, акт) повторяют
 * константы модуля (QUOTE_EDITABLE_STATUSES, INVOICEABLE_STATUSES) — только чтобы не показывать
 * заведомо бесполезную кнопку; окончательное решение и текст ошибки — всегда от сервера.
 */
import type { BanquetStatus } from './types';

export type RequestActionKey = 'take' | 'sendQuote' | 'sendNewVersion' | 'agree' | 'prepaid' | 'held' | 'rework' | 'cancel';

export interface RequestAction {
  key: RequestActionKey;
  /** Целевой статус для POST /transition. */
  to: BanquetStatus;
  emphasis: 'primary' | 'default' | 'danger';
  /** Подтверждение перед действием. */
  confirm: boolean;
  /** Диалог с причиной (отмена — причина обязательна). */
  needsReason: boolean;
}

export interface RequestActionSource {
  status: BanquetStatus | string;
  allowedTransitions: readonly string[];
}

const ORDER: RequestActionKey[] = ['take', 'sendQuote', 'sendNewVersion', 'agree', 'prepaid', 'held', 'rework', 'cancel'];
const PRIMARY_CANDIDATES: RequestActionKey[] = ['take', 'sendQuote', 'sendNewVersion', 'agree', 'prepaid', 'held'];

function actionFor(status: string, to: string): Omit<RequestAction, 'emphasis'> | null {
  switch (to) {
    case 'in_progress':
      // new → in_progress: взять в работу; quote_sent → in_progress: вернуть на доработку сметы.
      return status === 'new'
        ? { key: 'take', to, confirm: false, needsReason: false }
        : { key: 'rework', to, confirm: true, needsReason: false };
    case 'quote_sent':
      // Сервер отправляет последнюю версию сметы; из agreed — новую версию после согласования.
      return status === 'agreed'
        ? { key: 'sendNewVersion', to, confirm: true, needsReason: false }
        : { key: 'sendQuote', to, confirm: true, needsReason: false };
    case 'agreed':
      return { key: 'agree', to, confirm: true, needsReason: false };
    case 'prepaid':
      return { key: 'prepaid', to, confirm: true, needsReason: false };
    case 'held':
      return { key: 'held', to, confirm: true, needsReason: false };
    case 'cancelled':
      return { key: 'cancel', to, confirm: false, needsReason: true };
    default:
      return null;
  }
}

/**
 * Разрешённые сервером переходы → кнопки в порядке воронки. Главная (primary) — первая из
 * «движущих вперёд»; отмена — danger. Без права banquets.manage в филиале заявки кнопок нет.
 */
export function requestActions(source: RequestActionSource, canManage: boolean): RequestAction[] {
  if (!canManage) return [];
  const seen = new Set<RequestActionKey>();
  const actions: Array<Omit<RequestAction, 'emphasis'>> = [];
  for (const to of source.allowedTransitions) {
    const action = actionFor(source.status, to);
    if (!action || seen.has(action.key)) continue;
    seen.add(action.key);
    actions.push(action);
  }
  actions.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const primary = actions.find((a) => PRIMARY_CANDIDATES.includes(a.key))?.key;
  return actions.map((a) => ({ ...a, emphasis: a.key === 'cancel' ? 'danger' : a.key === primary ? 'primary' : 'default' }));
}

/** Заявка ещё в работе (не проведена и не отменена). */
export function isOpenStatus(status: string): boolean {
  return status !== 'held' && status !== 'cancelled';
}

/** Подсказка: смету можно сохранить новой версией (сервер: QUOTE_EDITABLE_STATUSES). */
export function canEditQuoteIn(status: string): boolean {
  return status === 'new' || status === 'in_progress' || status === 'quote_sent' || status === 'agreed';
}

/** Подсказка: по заявке выставляются счета (сервер: INVOICEABLE_STATUSES — есть согласованная смета). */
export function canInvoiceIn(status: string): boolean {
  return status === 'agreed' || status === 'prepaid' || status === 'held';
}

/**
 * Можно ли отправить клиенту версию сметы кнопкой в списке версий: только последнюю и ещё не отправленную,
 * пока смету можно менять. Повторную отправку той же версии сервер отклонит (banquet_quote.already_sent).
 */
export function canSendQuoteVersion(status: string, quote: { isLatest: boolean; sentAt: string | null }): boolean {
  return canEditQuoteIn(status) && quote.isLatest && !quote.sentAt;
}

/** Акт выполненных работ — после проведения банкета, один на заявку. */
export function canIssueActFor(status: string, hasAct: boolean): boolean {
  return status === 'held' && !hasAct;
}

/** ЭСФ по акту можно повторить при ошибке или когда готов черновик для ручной загрузки (сервер: RetryEsf). */
export function canRetryEsf(esfStatus: string): boolean {
  return esfStatus === 'failed' || esfStatus === 'draft_ready';
}
