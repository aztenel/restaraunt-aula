/**
 * Подключение к ленте событий по SSE: билет → EventSource → догрузка пропущенного после
 * переподключения. Переподключение с экспоненциальной задержкой; сторожевой таймер по ping.
 * Если эндпоинты ещё не развёрнуты (404) — тихо ждём и пробуем раз в 5 минут.
 */
import { ApiError } from '@aula/api-client';
import { reconnectDelay } from './feed-reducer';
import type { FeedStatus, FeedTicket } from './types';

export interface FeedConnectionDeps {
  getTicket(): Promise<FeedTicket>;
  getRecent(since: string): Promise<unknown>;
  streamUrl(ticket: string): string;
  createEventSource?(url: string): EventSource;
  onEvents(events: unknown[], source: 'live' | 'backfill'): void;
  onStatus(status: FeedStatus): void;
  now?(): number;
}

const UNAVAILABLE_RETRY_MS = 5 * 60_000;
const WATCHDOG_INTERVAL_MS = 30_000;
const SILENCE_LIMIT_MS = 75_000;

export class FeedConnection {
  private source: EventSource | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;
  private lastActivity = 0;
  private lastEventAt: string | null = null;
  private stopped = true;

  constructor(private readonly deps: FeedConnectionDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
    this.watchdog = setInterval(() => this.checkSilence(), WATCHDOG_INTERVAL_MS);
  }

  stop(): void {
    this.stopped = true;
    this.closeSource();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.retryTimer = null;
    this.watchdog = null;
    this.deps.onStatus('idle');
  }

  /** Для догрузки: время последнего полученного события. */
  setLastEventAt(iso: string | null): void {
    if (iso && (!this.lastEventAt || iso > this.lastEventAt)) this.lastEventAt = iso;
  }

  private closeSource(): void {
    this.source?.close();
    this.source = null;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(), delayMs);
  }

  private checkSilence(): void {
    if (this.stopped || !this.source) return;
    if (this.now() - this.lastActivity > SILENCE_LIMIT_MS) {
      this.closeSource();
      this.deps.onStatus('reconnecting');
      this.schedule(reconnectDelay(this.attempt++));
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.closeSource();
    this.deps.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let ticket: FeedTicket;
    try {
      ticket = await this.deps.getTicket();
    } catch (error) {
      if (this.stopped) return;
      if (error instanceof ApiError && (error.status === 404 || error.status === 501)) {
        // Модуль уведомлений ещё не развёрнут: лента отключена, без шума в интерфейсе.
        this.deps.onStatus('unavailable');
        this.schedule(UNAVAILABLE_RETRY_MS);
        return;
      }
      this.deps.onStatus('reconnecting');
      this.schedule(reconnectDelay(this.attempt++));
      return;
    }
    if (this.stopped) return;
    const create = this.deps.createEventSource ?? ((url: string) => new EventSource(url));
    const source = create(this.deps.streamUrl(ticket.ticket));
    this.source = source;
    this.lastActivity = this.now();

    source.onopen = () => {
      this.lastActivity = this.now();
      const since = this.lastEventAt;
      this.attempt = 0;
      this.deps.onStatus('open');
      if (since) void this.backfill(since);
      else this.lastEventAt = new Date(this.now()).toISOString();
    };
    source.addEventListener('feed', (message) => {
      this.lastActivity = this.now();
      try {
        const data = JSON.parse((message as MessageEvent<string>).data) as unknown;
        this.deps.onEvents([data], 'live');
        const at = (data as { occurredAt?: unknown })?.occurredAt;
        this.setLastEventAt(typeof at === 'string' ? at : new Date(this.now()).toISOString());
      } catch {
        // Некорректное событие пропускаем.
      }
    });
    source.addEventListener('ping', () => {
      this.lastActivity = this.now();
    });
    source.onerror = () => {
      // Билет одноразовый: встроенное переподключение EventSource не подходит — переподключаемся сами.
      if (this.source !== source) return;
      this.closeSource();
      this.deps.onStatus('reconnecting');
      this.schedule(reconnectDelay(this.attempt++));
    };
  }

  private async backfill(since: string): Promise<void> {
    try {
      const response = await this.deps.getRecent(since);
      const events = Array.isArray(response)
        ? response
        : Array.isArray((response as { items?: unknown[] })?.items)
          ? (response as { items: unknown[] }).items
          : [];
      if (events.length > 0) this.deps.onEvents(events, 'backfill');
    } catch {
      // Догрузка необязательна: очереди всё равно обновятся инвалидацией запросов.
    }
  }
}
