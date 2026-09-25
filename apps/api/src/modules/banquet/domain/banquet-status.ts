import { StateMachine } from '../../../shared/kernel/state-machine';
import { BanquetStatus } from '../public';

/**
 * Воронка банкетной заявки — конечный автомат (ТЗ, decisions.md «Банкеты и кейтеринг»):
 *
 *   new         -> in_progress | cancelled
 *   in_progress -> quote_sent | cancelled
 *   quote_sent  -> in_progress (доработка сметы) | agreed | cancelled
 *   agreed      -> quote_sent (новая версия сметы) | prepaid | cancelled
 *   prepaid     -> held | cancelled
 *   held, cancelled — финальные.
 */
export const BANQUET_FSM = new StateMachine<BanquetStatus>('banquet', {
  new: ['in_progress', 'cancelled'],
  in_progress: ['quote_sent', 'cancelled'],
  quote_sent: ['in_progress', 'agreed', 'cancelled'],
  agreed: ['quote_sent', 'prepaid', 'cancelled'],
  prepaid: ['held', 'cancelled'],
  held: [],
  cancelled: [],
});

export const ALL_BANQUET_STATUSES: readonly BanquetStatus[] = BANQUET_FSM.states();

/** Незавершённые заявки: в работе у менеджера (для автоназначения и очередей). */
export const OPEN_BANQUET_STATUSES: readonly BanquetStatus[] = ALL_BANQUET_STATUSES.filter((s) => !BANQUET_FSM.isFinal(s));

export function isOpenStatus(status: BanquetStatus): boolean {
  return OPEN_BANQUET_STATUSES.includes(status);
}

/** Статусы, в которых по заявке можно выставлять счета (есть согласованная смета). */
export const INVOICEABLE_STATUSES: readonly BanquetStatus[] = ['agreed', 'prepaid', 'held'];

/** Статусы, в которых смету можно менять (новая версия). */
export const QUOTE_EDITABLE_STATUSES: readonly BanquetStatus[] = ['new', 'in_progress', 'quote_sent', 'agreed'];

/** Обстоятельства заявки, от которых зависят доступные менеджеру переходы. */
export interface TransitionContext {
  status: BanquetStatus;
  /** Есть сохранённая версия сметы. */
  hasQuote: boolean;
  /** Последняя версия сметы уже отправлена клиенту. */
  latestQuoteSent: boolean;
  /** Оплачено не меньше требуемой предоплаты. */
  prepaymentCovered: boolean;
  /** Дата мероприятия наступила (локальная дата филиала). */
  eventDateReached: boolean;
}

/**
 * Переходы, доступные из админки прямо сейчас (для кнопок интерфейса: фронт не считает правила сам).
 * quote_sent — отправка последней версии сметы; agreed — клиент согласовал отправленную смету;
 * prepaid — только если предоплата получена; held — не раньше даты мероприятия.
 */
export function availableTransitions(ctx: TransitionContext): BanquetStatus[] {
  return BANQUET_FSM.allowedFrom(ctx.status).filter((to) => {
    switch (to) {
      case 'quote_sent':
        return ctx.hasQuote;
      case 'agreed':
        return ctx.latestQuoteSent;
      case 'prepaid':
        return ctx.prepaymentCovered;
      case 'held':
        return ctx.eventDateReached;
      default:
        return true;
    }
  });
}
