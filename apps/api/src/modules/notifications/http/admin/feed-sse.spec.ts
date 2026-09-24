import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Config } from '../../../../shared/infrastructure/config/config';
import { RedisConnection } from '../../../../shared/infrastructure/redis/redis';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { FEED_PING_INTERVAL_MS, FEED_STREAM_MAX_LIFETIME_MS, FeedItem } from '../../domain/feed';
import { FeedHub } from '../../infrastructure/feed-hub';
import { FeedSseConnections } from './feed-sse';

class FakeResponse extends EventEmitter {
  statusCode = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  writableEnded = false;
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  flushHeaders() {}
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.writableEnded = true;
    this.emit('close');
  }
}

const item = (id: string, branchId: string | null, stream: FeedItem['stream'] = 'orders'): FeedItem => ({
  id,
  occurredAt: '2026-10-01T06:00:00.000Z',
  branchId,
  stream,
  kind: 'created',
  entityId: id,
  title: id,
  sound: true,
});

describe('FeedSseConnections', () => {
  let hub: FeedHub;
  let connections: FeedSseConnections;
  const operator = new Actor({ kind: 'staff', userId: 'u', name: 'u', globalPermissions: [], branchPermissions: { b1: [Permission.OrdersView] } });

  beforeEach(() => {
    vi.useFakeTimers();
    hub = new FeedHub(new Config({ NODE_ENV: 'test' }), {} as RedisConnection);
    connections = new FeedSseConnections(hub);
  });
  afterEach(() => vi.useRealTimers());

  function open(backlog: FeedItem[] = []) {
    const res = new FakeResponse();
    const req = { socket: { setNoDelay: vi.fn(), setKeepAlive: vi.fn() } } as unknown as Request;
    connections.start(req, res as unknown as Response, operator, backlog);
    return res;
  }

  it('writes SSE headers, backlog, filtered feed events and pings every 25 seconds', () => {
    const res = open([item('old', 'b1')]);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['x-accel-buffering']).toBe('no');
    expect(res.chunks[0]).toBe('retry: 3000\n: connected\n\n');
    expect(res.chunks[1]).toBe(`id: old\nevent: feed\ndata: ${JSON.stringify(item('old', 'b1'))}\n\n`);

    hub.publish(item('foreign', 'b2'));
    hub.publish(item('system', null, 'system'));
    hub.publish(item('mine', 'b1'));
    expect(res.chunks.filter((c) => c.startsWith('id: '))).toHaveLength(2);
    expect(res.chunks.at(-1)).toContain('"entityId":"mine"');

    vi.advanceTimersByTime(FEED_PING_INTERVAL_MS);
    expect(res.chunks.at(-1)).toMatch(/^event: ping\ndata: .+\n\n$/);
    vi.advanceTimersByTime(FEED_PING_INTERVAL_MS);
    expect(res.chunks.filter((c) => c.startsWith('event: ping'))).toHaveLength(2);
  });

  it('client disconnect unsubscribes; the server ends streams on lifetime and on shutdown', () => {
    const res = open();
    expect(hub.listenerCount).toBe(1);
    res.emit('close');
    expect(hub.listenerCount).toBe(0);
    expect(connections.size).toBe(0);

    const long = open();
    vi.advanceTimersByTime(FEED_STREAM_MAX_LIFETIME_MS);
    expect(long.writableEnded).toBe(true);
    expect(hub.listenerCount).toBe(0);

    const a = open();
    const b = open();
    connections.onModuleDestroy();
    expect(a.writableEnded && b.writableEnded).toBe(true);
    expect(connections.size).toBe(0);
    const before = b.chunks.length;
    hub.publish(item('late', 'b1'));
    vi.advanceTimersByTime(FEED_PING_INTERVAL_MS);
    expect(b.chunks).toHaveLength(before);
  });
});
