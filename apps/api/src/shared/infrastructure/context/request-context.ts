import { AsyncLocalStorage } from 'node:async_hooks';
import { Actor } from '../../kernel/actor';
import { DEFAULT_LOCALE, Locale } from '../../kernel/translatable';

/**
 * Контекст запроса или фоновой задачи: кто действует, откуда, какой requestId.
 * Журнал аудита и логи берут пользователя отсюда.
 */
export interface RequestContextData {
  requestId: string;
  actor: Actor | null;
  ip: string | null;
  userAgent: string | null;
  locale: Locale;
}

const storage = new AsyncLocalStorage<RequestContextData>();

export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },

  current(): RequestContextData | undefined {
    return storage.getStore();
  },

  actor(): Actor | null {
    return storage.getStore()?.actor ?? null;
  },

  setActor(actor: Actor): void {
    const store = storage.getStore();
    if (store) store.actor = actor;
  },

  requestId(): string | null {
    return storage.getStore()?.requestId ?? null;
  },

  locale(): Locale {
    return storage.getStore()?.locale ?? DEFAULT_LOCALE;
  },

  /** Выполнить fn от имени системы (фоновые задачи, обработчики событий). */
  runAsSystem<T>(name: string, fn: () => T, requestId?: string): T {
    return storage.run(
      { requestId: requestId ?? `job-${Date.now()}`, actor: Actor.system(name), ip: null, userAgent: null, locale: DEFAULT_LOCALE },
      fn,
    );
  },
};
