import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TooManyRequestsError } from '../../kernel/errors';
import { RateLimiter } from './rate-limiter';

/**
 * Политики ограничения частоты для форм заказа, брони, авторизации, кодов и сертификатов.
 * Ключ — IP клиента (+ имя политики). Глобальная политика 'default' применяется ко всем маршрутам.
 */
export const RATE_LIMIT_POLICIES = {
  default: { limit: 600, windowSeconds: 60 },
  auth: { limit: 10, windowSeconds: 15 * 60 },
  forms: { limit: 20, windowSeconds: 10 * 60 },
  otp: { limit: 5, windowSeconds: 15 * 60 },
  certificate_check: { limit: 10, windowSeconds: 60 * 60 },
  pricing: { limit: 120, windowSeconds: 60 },
  tracking: { limit: 120, windowSeconds: 60 },
} as const;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

export const RATE_LIMIT_KEY = 'aula:rate_limit';
export const SKIP_RATE_LIMIT_KEY = 'aula:skip_rate_limit';

export const RateLimit = (...policies: RateLimitPolicyName[]): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, policies);

/** Для вебхуков провайдеров (их частоту контролирует провайдер) и health-check. */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, targets)) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? 'unknown';
    const policies: RateLimitPolicyName[] = [
      'default',
      ...(this.reflector.getAllAndOverride<RateLimitPolicyName[]>(RATE_LIMIT_KEY, targets) ?? []),
    ];
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    for (const name of policies) {
      const policy = RATE_LIMIT_POLICIES[name];
      const key = name === 'default' ? `default:${ip}` : `${name}:${route}:${ip}`;
      const result = await this.limiter.hit(key, policy.limit, policy.windowSeconds);
      if (!result.allowed) {
        throw new TooManyRequestsError('rate_limit.exceeded', 'Too many requests, try again later', {
          policy: name,
          retryAfterSeconds: result.retryAfterSeconds,
        });
      }
    }
    return true;
  }
}
