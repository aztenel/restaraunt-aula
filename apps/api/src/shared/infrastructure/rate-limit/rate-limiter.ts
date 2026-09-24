import { Injectable } from '@nestjs/common';
import { Config } from '../config/config';
import { RedisConnection } from '../redis/redis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Ограничение частоты: фиксированное окно в Redis (INCR + EXPIRE).
 * В тестах (NODE_ENV=test) — в памяти процесса.
 */
@Injectable()
export class RateLimiter {
  private readonly memory = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly config: Config,
    private readonly redis: RedisConnection,
  ) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    if (this.config.isTest) return this.hitMemory(key, limit, windowSeconds);
    const redisKey = `${this.config.queue.prefix}:rl:${key}`;
    const client = this.redis.get();
    const count = await client.incr(redisKey);
    if (count === 1) await client.expire(redisKey, windowSeconds);
    const ttl = count > limit ? await client.ttl(redisKey) : windowSeconds;
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds: Math.max(1, ttl) };
  }

  async reset(key: string): Promise<void> {
    if (this.config.isTest) {
      this.memory.delete(key);
      return;
    }
    await this.redis.get().del(`${this.config.queue.prefix}:rl:${key}`);
  }

  /** Для тестов. */
  clearMemory(): void {
    this.memory.clear();
  }

  private hitMemory(key: string, limit: number, windowSeconds: number): RateLimitResult {
    const now = Date.now();
    const entry = this.memory.get(key);
    if (!entry || entry.resetAt <= now) {
      this.memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { allowed: 1 <= limit, remaining: limit - 1, retryAfterSeconds: windowSeconds };
    }
    entry.count++;
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
}
