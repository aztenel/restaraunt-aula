import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { Config } from '../../../shared/infrastructure/config/config';
import { RedisConnection } from '../../../shared/infrastructure/redis/redis';
import { FeedItem } from '../domain/feed';
import { FeedHub } from './feed-hub';

class FakeRedisBus {
  subscriber = Object.assign(new EventEmitter(), {
    subscribed: [] as string[],
    subscribe: async (channel: string) => void this.subscriber.subscribed.push(channel),
    unsubscribe: async () => undefined,
  });
  published: Array<{ channel: string; message: string }> = [];
  failPublish = false;
  client = {
    publish: async (channel: string, message: string) => {
      if (this.failPublish) throw new Error('ECONNREFUSED');
      this.published.push({ channel, message });
      // Redis доставляет сообщение всем подписчикам, включая отправителя.
      this.subscriber.emit('message', channel, message);
      return 1;
    },
  };
  connection(): RedisConnection {
    return { get: () => this.client, sharedSubscriber: () => this.subscriber } as unknown as RedisConnection;
  }
}

const config = (env: string) => new Config({ NODE_ENV: env });
const item = (id: string): FeedItem => ({
  id,
  occurredAt: '2026-10-01T06:00:00.000Z',
  branchId: null,
  stream: 'system',
  kind: 'created',
  entityId: id,
  title: 't',
  sound: true,
});

describe('FeedHub', () => {
  it('delivers locally once and to other processes through Redis pub/sub', async () => {
    const bus = new FakeRedisBus();
    const hubA = new FeedHub(config('development'), bus.connection());
    const hubB = new FeedHub(config('development'), bus.connection());
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    hubA.subscribe((i) => receivedA.push(i.id));
    const unsubscribeB = hubB.subscribe((i) => receivedB.push(i.id));
    expect(bus.subscriber.subscribed).toEqual(['aula:notifications:admin-feed', 'aula:notifications:admin-feed']);

    hubA.publish(item('e1'));
    await new Promise((r) => setImmediate(r));
    expect(receivedA).toEqual(['e1']);
    expect(receivedB).toEqual(['e1']);
    expect(bus.published).toHaveLength(1);

    unsubscribeB();
    hubA.publish(item('e2'));
    await new Promise((r) => setImmediate(r));
    expect(receivedB).toEqual(['e1']);
    await hubA.onModuleDestroy();
    await hubB.onModuleDestroy();
  });

  it('Redis failures never propagate: local listeners still receive events', async () => {
    const bus = new FakeRedisBus();
    bus.failPublish = true;
    const hub = new FeedHub(config('staging'), bus.connection());
    const received: string[] = [];
    hub.subscribe((i) => received.push(i.id));
    expect(() => hub.publish(item('e1'))).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(received).toEqual(['e1']);
    bus.subscriber.emit('message', 'aula:notifications:admin-feed', 'not json');
    bus.subscriber.emit('error', new Error('connection lost'));
    const broken = new FeedHub(config('staging'), {
      get: () => {
        throw new Error('no redis');
      },
      sharedSubscriber: () => {
        throw new Error('no redis');
      },
    } as unknown as RedisConnection);
    broken.subscribe(() => {
      throw new Error('listener bug');
    });
    expect(() => broken.publish(item('e2'))).not.toThrow();
  });

  it('does not use Redis in tests', () => {
    const bus = new FakeRedisBus();
    const hub = new FeedHub(config('test'), bus.connection());
    const received: string[] = [];
    hub.subscribe((i) => received.push(i.id));
    hub.publish(item('e1'));
    expect(received).toEqual(['e1']);
    expect(bus.published).toEqual([]);
    expect(bus.subscriber.subscribed).toEqual([]);
  });
});
