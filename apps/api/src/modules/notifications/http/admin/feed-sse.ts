import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Actor } from '../../../../shared/kernel/actor';
import { canSeeFeedEvent, FEED_PING_INTERVAL_MS, FEED_STREAM_MAX_LIFETIME_MS, FeedItem } from '../../domain/feed';
import { FeedHub } from '../../infrastructure/feed-hub';

/**
 * Транспорт SSE (text/event-stream) для ленты админки:
 * - 'event: feed' — элемент очереди (JSON FeedItemDto), id = идентификатор события (Last-Event-ID);
 * - 'event: ping' — каждые 25 секунд;
 * фильтрация по правам сотрудника (поток и филиал) — на каждое событие.
 */
@Injectable()
export class FeedSseConnections implements OnModuleDestroy {
  private readonly open = new Set<() => void>();

  constructor(private readonly hub: FeedHub) {}

  get size(): number {
    return this.open.size;
  }

  start(req: Request, res: Response, actor: Actor, backlog: FeedItem[]): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Nginx и прокси не должны буферизовать поток.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);

    let closed = false;
    const write = (chunk: string) => {
      if (!closed && !res.writableEnded) res.write(chunk);
    };
    const send = (item: FeedItem) => write(`id: ${item.id}\nevent: feed\ndata: ${JSON.stringify(item)}\n\n`);

    write('retry: 3000\n: connected\n\n');
    for (const item of backlog) send(item);
    const unsubscribe = this.hub.subscribe((item) => {
      if (canSeeFeedEvent(actor, item)) send(item);
    });
    const ping = setInterval(() => write(`event: ping\ndata: ${new Date().toISOString()}\n\n`), FEED_PING_INTERVAL_MS);
    // Периодическое закрытие: клиент переподключается с новым билетом, права сотрудника актуализируются.
    const lifetime = setTimeout(() => close(), FEED_STREAM_MAX_LIFETIME_MS);
    ping.unref();
    lifetime.unref();

    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      clearTimeout(lifetime);
      unsubscribe();
      this.open.delete(close);
      if (!res.writableEnded) res.end();
    };
    this.open.add(close);
    // Обрыв соединения клиентом: 'close' ответа (у запроса 'close' наступает сразу после чтения тела).
    res.on('close', close);
    res.on('error', close);
  }

  onModuleDestroy(): void {
    for (const close of [...this.open]) close();
  }
}
