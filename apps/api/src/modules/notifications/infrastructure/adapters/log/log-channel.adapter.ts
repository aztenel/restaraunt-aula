import { Injectable, Logger } from '@nestjs/common';
import { ChannelSendRequest, ChannelSendResult, FallbackLogChannel } from '../../../application/channel-adapter';
import { maskAddress } from '../../../domain/masking';

export const LOG_PROVIDER = 'log';

/**
 * Канал «в журнал» для dev, тестов и стендов без настроенных мессенджеров: сообщение не уходит наружу,
 * а пишется в лог приложения целиком (разработчик видит, например, код подтверждения).
 * В продакшене не используется.
 */
@Injectable()
export class LogChannelAdapter extends FallbackLogChannel {
  readonly provider = LOG_PROVIDER;
  private readonly logger = new Logger('NotificationsLogChannel');

  async send(request: ChannelSendRequest): Promise<ChannelSendResult> {
    this.logger.log(
      {
        channel: request.channel,
        to: maskAddress(request.channel, request.to),
        template: request.template,
        locale: request.locale,
        subject: request.content.subject,
        attachments: request.attachments.map((a) => a.filename),
      },
      `[${request.channel} -> log] ${request.content.subject ? `${request.content.subject}\n` : ''}${request.content.text}`,
    );
    return { provider: LOG_PROVIDER, externalId: null };
  }
}
