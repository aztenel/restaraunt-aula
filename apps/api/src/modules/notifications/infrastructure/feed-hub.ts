import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Config } from '../../../shared/infrastructure/config/config';
import { RedisConnection } from '../../../shared/infrastructure/redis/redis';
import { randomToken } from '../../../shared/kernel/random';
import { FeedItem } from '../domain/feed';

type FeedListener = (item: FeedItem) => void;

interface FeedEnvelope {
  origin: string;
  item: FeedItem;
}

/**
 * Рассылка событий ленты открытым SSE-соединениям.
 * Событие, опубликованное в этом процессе, сразу получают локальные подписчики; другим процессам
 * (другие экземпляры API, события из воркера) оно уходит через Redis pub/sub.
 * Ошибки Redis никогда не пробрасываются: лента — вспомогательный канал, бизнес-операция не зависит от неё.
 * В тестах (NODE_ENV=test) Redis не используется — только локальная доставка.
 */
@Injectable()
export class FeedHub implements OnModuleDestroy {
  private readonly logger = new Logger(FeedHub.name);
  private readonly listeners = new Set<FeedListener>();
  private readonly instanceId = randomToken(9);
  private readonly channel: string;
  private readonly useRedis: boolean;
  private subscribed = false;
  private lastRedisErrorAt = 0;

  constructor(
    config: Config,
    private readonly redis: RedisConnection,
  ) {
    this.channel = `${config.queue.prefix}:notifications:admin-feed`;
    this.useRedis = !config.isTest;
  }

  /** Опубликовать событие (вызывается после коммита). Не бросает исключений. */
  publish(item: FeedItem): void {
    this.dispatch(item);
    if (!this.useRedis) return;
    try {
      const envelope: FeedEnvelope = { origin: this.instanceId, item };
      void this.redis
        .get()
        .publish(this.channel, JSON.stringify(envelope))
        .catch((err: unknown) => this.redisFailed(err, 'publish'));
    } catch (err) {
      this.redisFailed(err, 'publish');
    }
  }

  /** Подписка SSE-соединения; возвращает функцию отписки. */
  subscribe(listener: FeedListener): () => void {
    this.listeners.add(listener);
    this.ensureSubscribed();
    return () => {
      this.listeners.delete(listener);
    };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  private dispatch(item: FeedItem): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(item);
      } catch (err) {
        this.logger.warn({ err }, 'Admin feed listener failed');
      }
    }
  }

  private readonly onMessage = (channel: string, raw: string): void => {
    if (channel !== this.channel) return;
    try {
      const envelope = JSON.parse(raw) as FeedEnvelope;
      if (!envelope?.item || envelope.origin === this.instanceId) return;
      this.dispatch(envelope.item);
    } catch (err) {
      this.logger.warn({ err }, 'Invalid admin feed message in Redis');
    }
  };

  private readonly onError = (err: unknown): void => this.redisFailed(err, 'subscriber');

  private ensureSubscribed(): void {
    if (this.subscribed || !this.useRedis) return;
    this.subscribed = true;
    try {
      const subscriber = this.redis.sharedSubscriber();
      subscriber.on('message', this.onMessage);
      subscriber.on('error', this.onError);
      subscriber.subscribe(this.channel).catch((err: unknown) => {
        this.subscribed = false;
        subscriber.off('message', this.onMessage);
        subscriber.off('error', this.onError);
        this.redisFailed(err, 'subscribe');
      });
    } catch (err) {
      this.subscribed = false;
      this.redisFailed(err, 'subscribe');
    }
  }

  private redisFailed(err: unknown, operation: string): void {
    // Не засыпаем лог при длительной недоступности Redis: не чаще раза в минуту.
    const now = Date.now();
    if (now - this.lastRedisErrorAt < 60_000) return;
    this.lastRedisErrorAt = now;
    this.logger.warn({ err, operation }, 'Admin feed: Redis is unavailable, events are delivered only within this process');
  }

  async onModuleDestroy(): Promise<void> {
    this.listeners.clear();
    if (!this.subscribed) return;
    this.subscribed = false;
    try {
      const subscriber = this.redis.sharedSubscriber();
      subscriber.off('message', this.onMessage);
      subscriber.off('error', this.onError);
      // Без ожидания дольше секунды: при недоступном Redis команда ждала бы переподключения и держала остановку.
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        subscriber.unsubscribe(this.channel).catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1_000);
          timer.unref();
        }),
      ]);
      if (timer) clearTimeout(timer);
    } catch {
      // Соединение закрывается платформой при остановке.
    }
  }
}
