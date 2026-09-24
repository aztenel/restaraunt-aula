import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { normalizePhone } from '../../../shared/kernel/phone';
import { Locale } from '../../../shared/kernel/translatable';
import { maskAddress } from '../domain/masking';
import { templateInfo } from '../domain/templates';
import { DeliveryRepository, MessageRepository } from '../infrastructure/message.repository';
import { NotificationChannel } from '../public';
import { MessageSecrets } from './message-secrets';
import { QueueNotification } from './queue-notification.action';

export interface QueuedDelivery {
  messageId: string;
  deliveryId: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEGRAM_CHAT_RE = /^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/;

/** Адрес для канала: телефон нормализуется в +7XXXXXXXXXX, email — нижний регистр, Telegram — id чата или @канал. */
export function normalizeAddress(channel: NotificationChannel, raw: string): string {
  const value = (raw ?? '').trim();
  switch (channel) {
    case 'whatsapp':
    case 'sms':
      return normalizePhone(value);
    case 'email': {
      const email = value.toLowerCase();
      if (!EMAIL_RE.test(email)) throw new ValidationError('notification.invalid_email', 'Invalid email address');
      return email;
    }
    case 'telegram':
      if (!TELEGRAM_CHAT_RE.test(value)) throw new ValidationError('notification.invalid_chat_id', 'Telegram chat id or @channel expected');
      return value;
    default:
      throw new ValidationError('notification.invalid_channel', 'Unknown channel');
  }
}

/**
 * Повторная отправка доставки из журнала: новое сообщение с теми же шаблоном, параметрами и адресатом
 * (история исходной доставки не меняется). Коды подтверждения и сертификатов повторно не отправляются,
 * если секрет уже удалён после завершения доставки.
 */
@Injectable()
export class ResendDelivery {
  constructor(
    private readonly messages: MessageRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly secrets: MessageSecrets,
    private readonly queue: QueueNotification,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, deliveryId: string): Promise<QueuedDelivery> {
    actor.assertCan(Permission.IntegrationsManage);
    const record = await this.deliveries.findById(deliveryId);
    if (!record) throw new NotFoundError('notification_delivery', deliveryId);
    const message = await this.messages.findById(record.messageId);
    if (!message) throw new NotFoundError('notification_message', record.messageId);
    if (record.status === 'pending') {
      throw new ConflictError('notification.delivery_pending', 'Delivery is still in progress');
    }
    if (record.chain.length === 0) {
      throw new ConflictError('notification.no_address', 'Recipient has no address for the requested channels');
    }
    const info = templateInfo(message.template);
    if (!info) throw new ConflictError('notification.unknown_template', `Template ${message.template} no longer exists`);
    const secret = this.secrets.open(message.secretParams);
    if (info.sensitive.some((key) => message.params[key] !== undefined && secret[key] === undefined)) {
      throw new ConflictError('notification.resend_unavailable', 'One-time secret of this message is no longer stored');
    }
    const first = record.chain[0]!;
    return this.database.transaction(async () => {
      const queued = await this.queue.execute({
        audience: message.audience,
        template: message.template,
        params: { ...message.params, ...secret },
        locale: message.locale,
        recipient: { kind: 'direct', channel: first.channel, address: first.address, name: record.recipientName },
        attachments: message.attachments,
        related: message.relatedType && message.relatedId ? { type: message.relatedType, id: message.relatedId } : null,
        branchId: message.branchId,
        deliveries: [
          {
            targetKind: record.targetKind,
            staffUserId: record.staffUserId,
            recipientName: record.recipientName,
            chain: record.chain,
            requestedChannel: first.channel,
          },
        ],
        resentFromId: message.id,
        createdBy: actor.userId,
      });
      const [created] = await this.deliveries.forMessage(queued.messageId);
      await this.audit.record({
        action: 'notification.resent',
        entityType: 'notification_delivery',
        entityId: record.id,
        branchId: message.branchId,
        before: { status: record.status, channel: record.channel, lastError: record.lastError },
        after: { messageId: queued.messageId, deliveryId: created!.id, recipient: maskAddress(first.channel, first.address) },
      });
      return { messageId: queued.messageId, deliveryId: created!.id };
    });
  }
}

/**
 * Тестовая отправка в канал (проверка настроек интеграции): шаблон с примером параметров на указанный адрес.
 * Отправка — той же задачей доставки; результат виден в журнале доставки.
 */
@Injectable()
export class SendTestNotification {
  constructor(
    private readonly queue: QueueNotification,
    private readonly deliveries: DeliveryRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(
    actor: Actor,
    input: { channel: NotificationChannel; to: string; template?: string | null; locale?: Locale | null },
  ): Promise<QueuedDelivery> {
    actor.assertCan(Permission.IntegrationsManage);
    const key = input.template ?? 'staff.system_alert';
    const info = templateInfo(key);
    if (!info) throw new NotFoundError('notification_template', key);
    const address = normalizeAddress(input.channel, input.to);
    const params =
      key === 'staff.system_alert'
        ? { title: 'Тестовое сообщение AULA', details: `Проверка канала ${input.channel}. Отправил: ${actor.name}` }
        : info.sample;
    return this.database.transaction(async () => {
      const queued = await this.queue.execute({
        audience: info.audience,
        template: key,
        params,
        locale: input.locale ?? 'ru',
        recipient: { kind: 'direct', channel: input.channel, address, name: null },
        related: { type: 'test_send', id: actor.userId ?? 'system' },
        deliveries: [{ targetKind: 'direct', staffUserId: null, recipientName: null, chain: [{ channel: input.channel, address }], requestedChannel: input.channel }],
        createdBy: actor.userId,
      });
      const [created] = await this.deliveries.forMessage(queued.messageId);
      await this.audit.record({
        action: 'notification.test_sent',
        entityType: 'notification_delivery',
        entityId: created!.id,
        after: { channel: input.channel, template: key, recipient: maskAddress(input.channel, address) },
      });
      return { messageId: queued.messageId, deliveryId: created!.id };
    });
  }
}
