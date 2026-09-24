import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { IntegrationDescriptor } from '../../../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../../../shared/infrastructure/settings/integration-settings';
import {
  ChannelNotConfiguredError,
  ChannelSendRequest,
  ChannelSendResult,
  NotificationChannelAdapter,
} from '../../../application/channel-adapter';

/**
 * SMS-канал поверх нескольких SMS-шлюзов. Маршрутизация — настройка notifications.sms_routing:
 * порядок шлюзов и правила по префиксу номера (например, отдельный шлюз для номеров оператора).
 * Если шлюз отказал, сообщение сразу уходит через следующий настроенный шлюз.
 */
export abstract class SmsProvider {
  /** Код шлюза в настройках маршрутизации. */
  abstract readonly code: string;
  abstract isConfigured(): Promise<boolean>;
  abstract send(input: { to: string; text: string; correlationId: string }): Promise<{ externalId: string | null }>;
}

export const SMS_PROVIDERS = Symbol('SMS_PROVIDERS');
export const SMS_ROUTING_SETTINGS_KEY = 'notifications.sms_routing';

const SmsRoutingSchema = z.object({
  order: z.array(z.string().min(1)).optional(),
  prefixRules: z.array(z.object({ prefix: z.string().regex(/^\+?\d{1,11}$/), provider: z.string().min(1) })).optional(),
});
type SmsRouting = z.infer<typeof SmsRoutingSchema>;

export const SMS_ROUTING_DESCRIPTOR: IntegrationDescriptor = {
  key: SMS_ROUTING_SETTINGS_KEY,
  title: 'SMS: маршрутизация шлюзов',
  category: 'notifications',
  stage: 1,
  description:
    'Порядок SMS-шлюзов (mobizon, smsc) и правила по префиксу номера. Сообщение отправляется первым настроенным ' +
    'шлюзом; при отказе — следующим. Без настройки — все включённые шлюзы в порядке mobizon, smsc.',
  fields: [
    { name: 'order', label: 'Порядок шлюзов', type: 'json', help: '["mobizon", "smsc"]' },
    { name: 'prefixRules', label: 'Правила по префиксу', type: 'json', help: '[{ "prefix": "+7747", "provider": "smsc" }]' },
  ],
};

/** Порядок шлюзов для номера: правило по префиксу (самый длинный) — первым, затем общий порядок. */
export function routeSmsProviders(phone: string, available: readonly string[], routing: SmsRouting | null): string[] {
  const order = routing?.order && routing.order.length > 0 ? routing.order.filter((c) => available.includes(c)) : [...available];
  const normalized = phone.startsWith('+') ? phone : `+${phone}`;
  const rule = [...(routing?.prefixRules ?? [])]
    .map((r) => ({ ...r, prefix: r.prefix.startsWith('+') ? r.prefix : `+${r.prefix}` }))
    .filter((r) => normalized.startsWith(r.prefix) && available.includes(r.provider))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!rule) return order;
  return [rule.provider, ...order.filter((c) => c !== rule.provider)];
}

@Injectable()
export class SmsChannel extends NotificationChannelAdapter {
  readonly channel = 'sms' as const;
  private readonly logger = new Logger(SmsChannel.name);

  constructor(
    @Inject(SMS_PROVIDERS) private readonly providers: SmsProvider[],
    private readonly settings: IntegrationSettings,
  ) {
    super();
  }

  private async routing(): Promise<SmsRouting | null> {
    try {
      return await this.settings.get(SMS_ROUTING_SETTINGS_KEY, SmsRoutingSchema);
    } catch (err) {
      this.logger.warn({ err }, 'SMS routing settings are invalid, default order is used');
      return null;
    }
  }

  async configuredProviders(): Promise<string[]> {
    const result: string[] = [];
    for (const p of this.providers) {
      if (await p.isConfigured()) result.push(p.code);
    }
    return result;
  }

  async isConfigured(): Promise<boolean> {
    return (await this.configuredProviders()).length > 0;
  }

  async send(request: ChannelSendRequest): Promise<ChannelSendResult> {
    const configured = await this.configuredProviders();
    if (configured.length === 0) throw new ChannelNotConfiguredError('sms', 'no SMS gateway is enabled');
    const order = routeSmsProviders(request.to, configured, await this.routing());
    if (order.length === 0) throw new ChannelNotConfiguredError('sms', 'routing excludes all enabled gateways');
    const errors: ExternalServiceError[] = [];
    for (const code of order) {
      const provider = this.providers.find((p) => p.code === code)!;
      try {
        const result = await provider.send({ to: request.to, text: request.content.text, correlationId: request.deliveryId });
        return { provider: code, externalId: result.externalId };
      } catch (err) {
        if (!(err instanceof ExternalServiceError)) throw err;
        this.logger.warn({ provider: code, err: err.message, retryable: err.retryable }, 'SMS gateway failed, trying the next one');
        errors.push(err);
      }
    }
    // Все шлюзы отказали: если хоть один сбой временный — повторим позже, иначе ошибка постоянная.
    const retryable = errors.find((e) => e.retryable);
    throw retryable ?? errors[errors.length - 1]!;
  }
}
