/**
 * Кнопки воронки банкетной заявки — только из того, что разрешил сервер (allowedTransitions).
 * Фронт не знает автомата статусов и его условий (есть ли смета, отправлена ли она, покрыта ли
 * предоплата, наступила ли дата): он лишь сопоставляет разрешённый переход с кнопкой и подписью.
 * Остальные кнопки (новая версия сметы, отправка, счёт, акт, ЭСФ) — по флагам карточки заявки
 * (canEditQuote, canSendLatestQuote, canIssueInvoice, canIssueAct, act.esfRetryable).
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

/**
 * Заявка ещё в работе: у незавершённой заявки сервер всегда разрешает отмену, у проведённой и
 * отменённой переходов нет (правка деталей, зал, менеджер, лента доступны только в работе).
 */
export function isOpenRequest(source: Pick<RequestActionSource, 'allowedTransitions'>): boolean {
  return source.allowedTransitions.includes('cancelled');
}
