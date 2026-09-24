import { Injectable } from '@nestjs/common';
import { Permission } from '../../../shared/kernel/permissions';
import { Locale } from '../../../shared/kernel/translatable';
import { STAFF_LOCALE } from '../domain/templates';
import {
  GuestRecipient,
  GuestTemplate,
  GuestTemplateParams,
  NotificationAttachment,
  NotificationChannel,
  Notifier,
  StaffTemplate,
  StaffTemplateParams,
} from '../public';
import { QueueNotification } from './queue-notification.action';

/**
 * Реализация публичного контракта Notifier: запись сообщения в текущей транзакции вызывающего модуля
 * и задача доставки. Сама отправка — асинхронно (задача notifications.deliver).
 */
@Injectable()
export class NotifierService extends Notifier {
  constructor(private readonly queue: QueueNotification) {
    super();
  }

  async notifyGuest<T extends GuestTemplate>(input: {
    recipient: GuestRecipient;
    template: T;
    params: GuestTemplateParams[T];
    locale: Locale;
    channels?: NotificationChannel[];
    attachments?: NotificationAttachment[];
    dedupeKey?: string;
    related?: { type: string; id: string };
  }): Promise<void> {
    await this.queue.execute({
      audience: 'guest',
      template: input.template,
      params: input.params as unknown as Record<string, unknown>,
      locale: input.locale,
      recipient: { kind: 'guest', phone: input.recipient.phone ?? null, email: input.recipient.email ?? null, name: input.recipient.name ?? null },
      channels: input.channels,
      attachments: input.attachments,
      dedupeKey: input.dedupeKey,
      related: input.related,
    });
  }

  async notifyStaff<T extends StaffTemplate>(input: {
    audience: { branchId: string | null; permission?: Permission; userIds?: string[]; includeBranchChannels?: boolean };
    template: T;
    params: StaffTemplateParams[T];
    dedupeKey?: string;
    related?: { type: string; id: string };
  }): Promise<void> {
    await this.queue.execute({
      audience: 'staff',
      template: input.template,
      params: input.params as unknown as Record<string, unknown>,
      locale: STAFF_LOCALE,
      recipient: {
        kind: 'staff',
        branchId: input.audience.branchId ?? null,
        permission: input.audience.permission ?? null,
        userIds: [...new Set(input.audience.userIds ?? [])],
        includeBranchChannels: input.audience.includeBranchChannels ?? null,
      },
      dedupeKey: input.dedupeKey,
      related: input.related,
      branchId: input.audience.branchId ?? null,
    });
  }
}
