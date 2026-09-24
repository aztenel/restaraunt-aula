import { Global, Module, OnModuleInit } from '@nestjs/common';
import { HttpTransport } from '../../shared/infrastructure/integrations/external-http';
import { IntegrationCatalog } from '../../shared/infrastructure/settings/integration-catalog';
import { AdminFeedService } from './application/admin-feed.service';
import { AlertJobFailure } from './application/alert-job-failure.action';
import { ApplyChannelStatuses } from './application/apply-channel-statuses.action';
import { CHANNEL_ADAPTERS, FallbackLogChannel, NotificationChannelAdapter } from './application/channel-adapter';
import { ChannelRegistry } from './application/channel-registry';
import { WHATSAPP_STATUS_WEBHOOK } from './application/channel-status-webhook';
import { DeliverMessage } from './application/deliver-message.action';
import { ResendDelivery, SendTestNotification } from './application/delivery.actions';
import { IssueFeedTicket, OpenFeedStream } from './application/feed.actions';
import { FeedQueries } from './application/feed.queries';
import { CleanupAdminFeed, PurgeMessageSecrets } from './application/maintenance.actions';
import { MessageSecrets } from './application/message-secrets';
import { NotificationQueries } from './application/notification.queries';
import { NotifierService } from './application/notifier.service';
import { QueueNotification } from './application/queue-notification.action';
import { StaffAudienceResolver } from './application/staff-audience';
import { PreviewTemplate, ResetTemplateText, UpdateTemplateText } from './application/template.actions';
import { TemplateRenderer } from './application/template-renderer';
import { DeliverNotificationJob } from './handlers/deliver.job';
import { JobFailedAlertHandler } from './handlers/job-failed.handler';
import { NotificationsMaintenance } from './handlers/maintenance.schedule';
import { NotificationDeliveriesController } from './http/admin/deliveries.controller';
import { AdminFeedController } from './http/admin/feed.controller';
import { FeedSseConnections } from './http/admin/feed-sse';
import { NotificationTemplatesController } from './http/admin/templates.controller';
import { WhatsAppWebhookController } from './http/webhooks/whatsapp.controller';
import { LogChannelAdapter } from './infrastructure/adapters/log/log-channel.adapter';
import { MOBIZON_DESCRIPTOR, MobizonSmsProvider } from './infrastructure/adapters/mobizon/mobizon.sms-provider';
import { SMS_PROVIDERS, SMS_ROUTING_DESCRIPTOR, SmsChannel, SmsProvider } from './infrastructure/adapters/sms/sms-channel';
import { SMSC_DESCRIPTOR, SmscSmsProvider } from './infrastructure/adapters/smsc/smsc.sms-provider';
import { SMTP_DESCRIPTOR, SmtpEmailAdapter, SmtpTransportFactory } from './infrastructure/adapters/smtp/smtp-email.adapter';
import { TELEGRAM_DESCRIPTOR, TelegramBotAdapter } from './infrastructure/adapters/telegram/telegram-bot.adapter';
import { WHATSAPP_DESCRIPTOR, WhatsAppCloudAdapter } from './infrastructure/adapters/whatsapp/whatsapp-cloud.adapter';
import { FeedHub } from './infrastructure/feed-hub';
import { FeedRepository, ProviderEventRepository } from './infrastructure/feed.repository';
import { DeliveryRepository, MessageRepository } from './infrastructure/message.repository';
import { createNotificationsHttp, NOTIFICATIONS_HTTP, RedactingIntegrationLog } from './infrastructure/redaction';
import { TemplateRepository } from './infrastructure/template.repository';
import { AdminFeed, Notifier } from './public';

/**
 * Notifications: уведомления гостю (WhatsApp Business, SMS — Mobizon / SMSC.kz, email по SMTP) и персоналу
 * (WhatsApp точки, Telegram), лента событий админки (SSE). Отправка — только задачей в очереди с повторами
 * и резервными каналами; недоступность мессенджера не блокирует бизнес-операции.
 */
@Global()
@Module({
  controllers: [NotificationTemplatesController, NotificationDeliveriesController, AdminFeedController, WhatsAppWebhookController],
  providers: [
    // Хранилище
    TemplateRepository,
    MessageRepository,
    DeliveryRepository,
    FeedRepository,
    ProviderEventRepository,
    FeedHub,
    RedactingIntegrationLog,
    { provide: NOTIFICATIONS_HTTP, useFactory: createNotificationsHttp, inject: [HttpTransport, RedactingIntegrationLog] },
    // Адаптеры каналов
    WhatsAppCloudAdapter,
    TelegramBotAdapter,
    SmtpTransportFactory,
    SmtpEmailAdapter,
    MobizonSmsProvider,
    SmscSmsProvider,
    {
      provide: SMS_PROVIDERS,
      useFactory: (...providers: SmsProvider[]) => providers,
      inject: [MobizonSmsProvider, SmscSmsProvider],
    },
    SmsChannel,
    {
      provide: CHANNEL_ADAPTERS,
      useFactory: (...adapters: NotificationChannelAdapter[]) => adapters,
      inject: [WhatsAppCloudAdapter, SmsChannel, SmtpEmailAdapter, TelegramBotAdapter],
    },
    { provide: FallbackLogChannel, useClass: LogChannelAdapter },
    { provide: WHATSAPP_STATUS_WEBHOOK, useExisting: WhatsAppCloudAdapter },
    // Приложение
    ChannelRegistry,
    TemplateRenderer,
    MessageSecrets,
    StaffAudienceResolver,
    QueueNotification,
    DeliverMessage,
    ApplyChannelStatuses,
    AlertJobFailure,
    UpdateTemplateText,
    ResetTemplateText,
    PreviewTemplate,
    ResendDelivery,
    SendTestNotification,
    IssueFeedTicket,
    OpenFeedStream,
    FeedQueries,
    NotificationQueries,
    CleanupAdminFeed,
    PurgeMessageSecrets,
    FeedSseConnections,
    // Обработчики
    DeliverNotificationJob,
    JobFailedAlertHandler,
    NotificationsMaintenance,
    // Публичный контракт
    { provide: Notifier, useClass: NotifierService },
    { provide: AdminFeed, useClass: AdminFeedService },
  ],
  exports: [Notifier, AdminFeed],
})
export class NotificationsModule implements OnModuleInit {
  constructor(private readonly catalog: IntegrationCatalog) {}

  onModuleInit(): void {
    for (const descriptor of [
      WHATSAPP_DESCRIPTOR,
      MOBIZON_DESCRIPTOR,
      SMSC_DESCRIPTOR,
      SMS_ROUTING_DESCRIPTOR,
      SMTP_DESCRIPTOR,
      TELEGRAM_DESCRIPTOR,
    ]) {
      this.catalog.register(descriptor);
    }
  }
}
