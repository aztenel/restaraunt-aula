/**
 * Сессия сотрудника. Access-токен хранится ТОЛЬКО в памяти (не в localStorage — защита от XSS),
 * refresh-токен — в httpOnly cookie (path=/api/v1/admin/auth), его браузер отправляет сам.
 *
 *  - refresh() — однопоточное обновление: параллельные 401 ждут один запрос; между вкладками
 *    запросы сериализуются через Web Locks (ротация refresh-токена + детект повторного
 *    использования на сервере иначе разлогинит все вкладки);
 *  - проактивное обновление за минуту до истечения access-токена;
 *  - подписка на изменения (AuthProvider).
 */
import type { Session } from '@aula/api-client';

export interface SessionState {
  accessToken: string | null;
  /** Unix ms, когда истекает access-токен. */
  expiresAt: number | null;
  mustChangePassword: boolean;
}

type Listener = (state: SessionState, reason: 'set' | 'refreshed' | 'cleared' | 'expired') => void;

export interface SessionManagerOptions {
  /** Запрос POST /admin/auth/refresh. Бросает ошибку, если сессии нет. */
  refresh?: () => Promise<Session>;
  now?: () => number;
  /** Обновлять за столько мс до истечения. */
  refreshAheadMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  locks?: Pick<LockManager, 'request'> | null;
}

const LOCK_NAME = 'aula-admin-refresh';
const EMPTY: SessionState = { accessToken: null, expiresAt: null, mustChangePassword: false };

export class SessionManager {
  private state: SessionState = EMPTY;
  private inflight: Promise<boolean> | null = null;
  private timer: unknown = null;
  private readonly listeners = new Set<Listener>();
  private refreshFn: (() => Promise<Session>) | null;
  private readonly now: () => number;
  private readonly refreshAheadMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly locks: Pick<LockManager, 'request'> | null;

  constructor(options: SessionManagerOptions = {}) {
    this.refreshFn = options.refresh ?? null;
    this.now = options.now ?? (() => Date.now());
    this.refreshAheadMs = options.refreshAheadMs ?? 60_000;
    this.setTimer = options.setTimer ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.locks =
      options.locks !== undefined
        ? options.locks
        : typeof navigator !== 'undefined' && 'locks' in navigator
          ? navigator.locks
          : null;
  }

  configure(options: { refresh: () => Promise<Session> }): void {
    this.refreshFn = options.refresh;
  }

  getState(): SessionState {
    return this.state;
  }

  getAccessToken(): string | null {
    return this.state.accessToken;
  }

  isAuthenticated(): boolean {
    return this.state.accessToken !== null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSession(session: Session, reason: 'set' | 'refreshed' = 'set'): void {
    this.state = {
      accessToken: session.accessToken,
      expiresAt: this.now() + session.expiresIn * 1000,
      mustChangePassword: session.mustChangePassword,
    };
    this.schedule(session.expiresIn * 1000);
    this.emit(reason);
  }

  /** Выход или окончательная потеря сессии. */
  clear(reason: 'cleared' | 'expired' = 'cleared'): void {
    this.cancelTimer();
    const had = this.state.accessToken !== null;
    this.state = EMPTY;
    if (had || reason === 'cleared') this.emit(reason);
  }

  /**
   * Обновить access-токен по refresh-cookie. true — успешно; false — сессии нет
   * (состояние очищается, подписчики получают 'expired').
   */
  refresh(): Promise<boolean> {
    if (this.inflight) return this.inflight;
    const run = async (): Promise<boolean> => {
      if (!this.refreshFn) return false;
      try {
        const session = await this.refreshFn();
        this.setSession(session, 'refreshed');
        return true;
      } catch {
        this.clear('expired');
        return false;
      }
    };
    // Web Locks: промис request() разрешается значением колбэка (boolean).
    const withLock = this.locks ? () => this.locks!.request(LOCK_NAME, run) as unknown as Promise<boolean> : run;
    this.inflight = withLock().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private schedule(ttlMs: number): void {
    this.cancelTimer();
    const delay = Math.max(5_000, ttlMs - this.refreshAheadMs);
    this.timer = this.setTimer(() => {
      void this.refresh();
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private emit(reason: Parameters<Listener>[1]): void {
    for (const listener of this.listeners) listener(this.state, reason);
  }
}

/** Единственная сессия приложения. */
export const session = new SessionManager();
