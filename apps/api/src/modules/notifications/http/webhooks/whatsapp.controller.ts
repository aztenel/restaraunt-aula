import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../../../shared/infrastructure/http/decorators';
import { SkipRateLimit } from '../../../../shared/infrastructure/rate-limit/rate-limit.guard';
import { ForbiddenError } from '../../../../shared/kernel/errors';
import { ApplyChannelStatuses } from '../../application/apply-channel-statuses.action';
import { ChannelStatusWebhook, WHATSAPP_STATUS_WEBHOOK } from '../../application/channel-status-webhook';
import { WebhookAckDto } from '../dto';

/**
 * Вебхук статусов WhatsApp Business: доставлено, прочитано, ошибка (номер не в WhatsApp и т.п.).
 * Ошибка уже отправленного сообщения переводит доставку на SMS. Подпись проверяется, обработка идемпотентна.
 */
@ApiTags('webhooks')
@Public()
@SkipRateLimit()
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    @Inject(WHATSAPP_STATUS_WEBHOOK) private readonly webhook: ChannelStatusWebhook,
    private readonly applyStatuses: ApplyChannelStatuses,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Подтверждение подписки на вебхук (hub.mode, hub.verify_token, hub.challenge)' })
  @ApiProduces('text/plain')
  @ApiOkResponse({ description: 'hub.challenge', schema: { type: 'string' } })
  async verify(@Req() req: Request, @Res() res: Response): Promise<void> {
    const challenge = await this.webhook.verifySubscription(req.query as Record<string, unknown>);
    if (challenge === null) throw new ForbiddenError('webhook.verification_failed', 'Webhook verification failed');
    res.status(200).type('text/plain').send(challenge);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Статусы сообщений WhatsApp (подпись X-Hub-Signature-256)' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ type: WebhookAckDto })
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Body() body: Record<string, unknown>): Promise<WebhookAckDto> {
    const updates = await this.webhook.parseStatuses({ headers: req.headers, rawBody: req.rawBody, body });
    const result = await this.applyStatuses.execute(updates);
    return { received: true, ...result };
  }
}
