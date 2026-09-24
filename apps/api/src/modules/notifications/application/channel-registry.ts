import { Inject, Injectable } from '@nestjs/common';
import { Config } from '../../../shared/infrastructure/config/config';
import { NOTIFICATION_CHANNELS } from '../domain/delivery-plan';
import { NotificationChannel } from '../public';
import { CHANNEL_ADAPTERS, FallbackLogChannel, NotificationChannelAdapter } from './channel-adapter';

export interface ChannelStatus {
  channel: NotificationChannel;
  configured: boolean;
  providers: string[];
  /** Вне продакшена ненастроенный канал пишет сообщения в журнал приложения. */
  logFallback: boolean;
}

/** Адаптеры каналов по имени канала + служебный канал «в журнал» (не в продакшене). */
@Injectable()
export class ChannelRegistry {
  private readonly byChannel = new Map<NotificationChannel, NotificationChannelAdapter>();

  constructor(
    @Inject(CHANNEL_ADAPTERS) adapters: NotificationChannelAdapter[],
    private readonly logChannel: FallbackLogChannel,
    private readonly config: Config,
  ) {
    for (const adapter of adapters) this.byChannel.set(adapter.channel, adapter);
  }

  adapter(channel: NotificationChannel): NotificationChannelAdapter | null {
    return this.byChannel.get(channel) ?? null;
  }

  async isConfigured(channel: NotificationChannel): Promise<boolean> {
    const adapter = this.adapter(channel);
    return adapter ? adapter.isConfigured() : false;
  }

  /** Служебный канал доступен только вне продакшена. */
  fallbackLog(): FallbackLogChannel | null {
    return this.config.isProduction ? null : this.logChannel;
  }

  async statuses(): Promise<ChannelStatus[]> {
    const logFallback = !this.config.isProduction;
    const result: ChannelStatus[] = [];
    for (const channel of NOTIFICATION_CHANNELS) {
      const adapter = this.adapter(channel);
      const providers = adapter ? await adapter.configuredProviders() : [];
      result.push({ channel, configured: providers.length > 0, providers, logFallback });
    }
    return result;
  }
}
