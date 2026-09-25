import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@aula/api-client';
import { FeedConnection } from './connection';
import type { FeedStatus } from './types';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(e: MessageEvent<string>) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (e: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data: unknown) {
    for (const l of this.listeners.get(type) ?? []) l({ data: JSON.stringify(data), lastEventId: '' } as MessageEvent<string>);
  }
  close() {
    this.closed = true;
  }
}

describe('FeedConnection (SSE ленты событий)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  it('404 на билет — лента недоступна (модуль не развёрнут), без ошибок', async () => {
    const statuses: FeedStatus[] = [];
    const connection = new FeedConnection({
      getTicket: () => Promise.reject(new ApiError({ status: 404, code: 'http.404' })),
      getRecent: vi.fn(),
      streamUrl: (t) => `/stream?ticket=${t}`,
      createEventSource: (url) => new FakeEventSource(url) as unknown as EventSource,
      onEvents: vi.fn(),
      onStatus: (s) => statuses.push(s),
    });
    connection.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toEqual(['connecting', 'unavailable']);
    expect(FakeEventSource.instances).toHaveLength(0);
    connection.stop();
  });

  it('получает события, при обрыве переподключается с новым билетом и догружает пропущенное', async () => {
    let ticketNo = 0;
    const onEvents = vi.fn();
    const getRecent = vi.fn(async () => ({ items: [{ id: 'missed' }] }));
    const statuses: FeedStatus[] = [];
    const connection = new FeedConnection({
      getTicket: async () => ({ ticket: `t${++ticketNo}`, expiresIn: 60 }),
      getRecent,
      streamUrl: (t) => `/stream?ticket=${t}`,
      createEventSource: (url) => new FakeEventSource(url) as unknown as EventSource,
      onEvents,
      onStatus: (s) => statuses.push(s),
      now: () => Date.parse('2026-09-25T10:00:00.000Z'),
    });
    connection.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = FakeEventSource.instances[0]!;
    expect(first.url).toBe('/stream?ticket=t1');
    first.onopen?.();
    first.emit('feed', { id: 'e1', occurredAt: '2026-09-25T10:05:00.000Z' });
    expect(onEvents).toHaveBeenCalledWith([{ id: 'e1', occurredAt: '2026-09-25T10:05:00.000Z' }], 'live');

    first.onerror?.();
    expect(first.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    const second = FakeEventSource.instances[1]!;
    expect(second.url).toBe('/stream?ticket=t2');
    second.onopen?.();
    await vi.advanceTimersByTimeAsync(0);
    // Курсор догрузки — id последнего события.
    expect(getRecent).toHaveBeenCalledWith('e1');
    expect(onEvents).toHaveBeenLastCalledWith([{ id: 'missed' }], 'backfill');
    expect(statuses).toContain('reconnecting');
    connection.stop();
    expect(second.closed).toBe(true);
  });
});
