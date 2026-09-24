import { ValidationError } from '../../../shared/kernel/errors';
import { StateMachine } from '../../../shared/kernel/state-machine';
import { addDays, startOfLocalDay, toLocalDate } from '../../../shared/kernel/time';
import { DishAvailability } from '../public';
import { TEXT_LIMITS } from './dish';

/**
 * Стоп-лист блюда в филиале. В БД — два состояния позиции меню: доступно / в стоп-листе.
 * Как показывать блюдо из стоп-листа на витрине (скрыть или пометить недоступным) — настройка филиала
 * stopListMode; отсюда три значения DishAvailability в публичном контракте.
 * Стоп может быть «до» момента времени — тогда позиция возвращается автоматически (@Scheduled).
 */
export const MenuItemAvailability = {
  Available: 'available',
  Stopped: 'stopped',
} as const;
export type MenuItemAvailability = (typeof MenuItemAvailability)[keyof typeof MenuItemAvailability];

export const STOP_LIST_MACHINE = new StateMachine<MenuItemAvailability>('catalog.stop_list', {
  available: ['stopped'],
  stopped: ['available'],
});

export type StopSource = 'manual' | 'pos';
export type StopListMode = 'hide' | 'mark_unavailable';

/** Максимальный срок стопа «до времени»: дальше — бессрочный стоп (до ручного возврата). */
export const MAX_STOP_DAYS = 30;

export interface StopListState {
  availability: MenuItemAvailability;
  stoppedUntil: Date | null;
  stopReason: string | null;
  stopSource: StopSource | null;
  stoppedAt: Date | null;
}

export const AVAILABLE: StopListState = {
  availability: 'available',
  stoppedUntil: null,
  stopReason: null,
  stopSource: null,
  stoppedAt: null,
};

export interface StopListChange {
  state: StopListState;
  /** Изменилось ли что-то (для журнала и событий; повтор того же действия — без изменений). */
  changed: boolean;
  /** Был ли переход доступно <-> стоп. */
  transitioned: boolean;
}

/** Фактическая доступность: стоп с истёкшим «до» уже считается доступным (не ждём фоновую задачу). */
export function effectiveAvailability(state: Pick<StopListState, 'availability' | 'stoppedUntil'>, now: Date): MenuItemAvailability {
  if (state.availability === 'stopped' && state.stoppedUntil && state.stoppedUntil.getTime() <= now.getTime()) {
    return 'available';
  }
  return state.availability;
}

export function validateStopUntil(until: Date | null, now: Date): Date | null {
  if (!until) return null;
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) {
    throw new ValidationError('catalog.stop_until_invalid', 'Stop-list "until" must be in the future', { until });
  }
  if (until.getTime() > now.getTime() + MAX_STOP_DAYS * 86_400_000) {
    throw new ValidationError('catalog.stop_until_invalid', `Stop-list "until" must be within ${MAX_STOP_DAYS} days`, { until });
  }
  return until;
}

function normalizeReason(reason: string | null | undefined): string | null {
  const text = reason?.trim() ?? '';
  if (text.length > TEXT_LIMITS.stopReason) {
    throw new ValidationError('catalog.text_too_long', 'Stop reason is too long', { max: TEXT_LIMITS.stopReason });
  }
  return text || null;
}

/** Поставить в стоп-лист. Повторный стоп обновляет «до» и причину без перехода состояния. */
export function stopItem(
  state: StopListState,
  input: { until: Date | null; reason?: string | null; source: StopSource; now: Date },
): StopListChange {
  const until = validateStopUntil(input.until, input.now);
  const reason = normalizeReason(input.reason);
  const current = effectiveAvailability(state, input.now);
  if (state.availability === 'stopped' && current === 'stopped') {
    const changed =
      (state.stoppedUntil?.getTime() ?? null) !== (until?.getTime() ?? null) || state.stopReason !== reason || state.stopSource !== input.source;
    return {
      state: { ...state, stoppedUntil: until, stopReason: reason, stopSource: input.source },
      changed,
      transitioned: false,
    };
  }
  STOP_LIST_MACHINE.assertTransition('available', 'stopped');
  return {
    state: { availability: 'stopped', stoppedUntil: until, stopReason: reason, stopSource: input.source, stoppedAt: input.now },
    changed: true,
    transitioned: true,
  };
}

/** Вернуть в продажу. Для доступной позиции — без изменений (идемпотентно). */
export function restoreItem(state: StopListState): StopListChange {
  if (state.availability === 'available') return { state, changed: false, transitioned: false };
  STOP_LIST_MACHINE.assertTransition('stopped', 'available');
  return { state: { ...AVAILABLE }, changed: true, transitioned: true };
}

/** Стоп с истёкшим «до» — кандидат на автоматический возврат. */
export function isStopExpired(state: Pick<StopListState, 'availability' | 'stoppedUntil'>, now: Date): boolean {
  return state.availability === 'stopped' && !!state.stoppedUntil && state.stoppedUntil.getTime() <= now.getTime();
}

/** Значение для витрины и других модулей с учётом настройки филиала. */
export function displayAvailability(effective: MenuItemAvailability, mode: StopListMode): DishAvailability {
  if (effective === 'available') return DishAvailability.Available;
  return mode === 'hide' ? DishAvailability.StoppedHidden : DishAvailability.StoppedShown;
}

/** «До конца дня» в часовом поясе филиала: ближайшая локальная полночь. */
export function endOfLocalDay(now: Date, timeZone: string): Date {
  return startOfLocalDay(addDays(toLocalDate(now, timeZone), 1), timeZone);
}
