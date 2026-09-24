import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../../shared/infrastructure/http/decorators';
import { SkipRateLimit } from '../../../../shared/infrastructure/rate-limit/rate-limit.guard';
import { ReceivePaymentWebhook } from '../../application/receive-webhook.action';
import { WebhookRequest } from '../../domain/payment-gateway';

/**
 * Сырое тело нужно для проверки HMAC-подписи. Если платформа сохраняет его (NestFactory rawBody: true),
 * используется req.rawBody; иначе — каноническая сериализация разобранного JSON (совпадает с исходной
 * для компактного JSON без экранирования; провайдеры с подписью в теле, как Halyk secret_hash, от этого не зависят).
 */
export function toWebhookRequest(req: RawBodyRequest<Request>): WebhookRequest {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[key.toLowerCase()] = value;
    else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(', ');
  }
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.query ?? {})) {
    if (typeof value === 'string') query[key] = value;
  }
  const raw = req.rawBody ? req.rawBody.toString('utf8') : null;
  const body = req.body ?? {};
  return {
    headers,
    query,
    body,
    rawBody: raw ?? (typeof body === 'string' ? body : JSON.stringify(body)),
    rawBodyIsExact: raw !== null,
  };
}

/**
 * Входящие уведомления платёжных провайдеров. Идемпотентно: повтор с тем же идентификатором события
 * не меняет состояние. Частоту контролирует провайдер — ограничение частоты не применяется.
 */
@ApiTags('webhooks')
@Public()
@SkipRateLimit()
@Controller('webhooks/payments')
export class PaymentsWebhookController {
  constructor(private readonly receive: ReceivePaymentWebhook) {}

  @Post(':provider')
  @HttpCode(200)
  @ApiParam({ name: 'provider', description: 'Имя провайдера из настроек платежей' })
  @ApiBody({ description: 'Уведомление в формате провайдера', schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ description: 'Уведомление принято', schema: { type: 'object', additionalProperties: true, example: { received: true } } })
  async handle(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>): Promise<Record<string, unknown>> {
    const result = await this.receive.execute(provider, toWebhookRequest(req));
    return result.ack;
  }
}
