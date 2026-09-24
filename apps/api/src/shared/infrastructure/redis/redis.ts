import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import IORedis from 'ioredis';
import { Config } from '../config/config';

/** Ленивое подключение к Redis: кэш, ограничение частоты, pub/sub для админки. */
@Injectable()
export class RedisConnection implements OnApplicationShutdown {
  private client: IORedis | null = null;
  private subscriber: IORedis | null = null;

  constructor(private readonly config: Config) {}

  get(): IORedis {
    if (!this.client) {
      this.client = new IORedis(this.config.redis.url, { maxRetriesPerRequest: 3, lazyConnect: false });
    }
    return this.client;
  }

  /** Отдельное соединение для SUBSCRIBE (в режиме подписки команды недоступны). */
  createSubscriber(): IORedis {
    return new IORedis(this.config.redis.url, { maxRetriesPerRequest: null });
  }

  sharedSubscriber(): IORedis {
    if (!this.subscriber) this.subscriber = this.createSubscriber();
    return this.subscriber;
  }

  async onApplicationShutdown(): Promise<void> {
    this.client?.disconnect();
    this.subscriber?.disconnect();
  }
}
