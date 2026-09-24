import { Injectable, Logger } from '@nestjs/common';
import { sha256 } from '../../../shared/infrastructure/crypto/secret-box';
import { Database } from '../../../shared/infrastructure/database/database';
import { JobQueue } from '../../../shared/infrastructure/events/event-bus';
import { Clock } from '../../../shared/kernel/clock';
import { ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { tryNormalizePhone } from '../../../shared/kernel/phone';
import { Locale, parseLocale } from '../../../shared/kernel/translatable';
import { DeliveryStatus } from '../domain/delivery';
import { ChannelPlan, guestChannelPlan, PlannedDelivery } from '../domain/delivery-plan';
import { splitSensitiveParams } from '../domain/masking';
import { TemplateAudience, templateInfo } from '../domain/templates';
import { DeliveryRepository, MessageRecipient, MessageRepository, NewDelivery } from '../infrastructure/message.repository';
import { NotificationAttachment, NotificationChannel } from '../public';
import { MessageSecrets } from './message-secrets';

export const DELIVER_JOB = 'notifications.deliver';

export interface DeliverJobPayload {
  messageId: string;
}

export interface QueueNotificationInput {
  audience: TemplateAudience;
  template: string;
  params: Record<string, unknown>;
  locale: Locale;
  recipient: MessageRecipient;
  channels?: NotificationChannel[];
  attachments?: NotificationAttachment[];
  dedupeKey?: string | null;
  related?: { type: string; id: string } | null;
  branchId?: string | null;
  /** Заранее известные доставки (повтор, тестовая отправка): адресаты не разрешаются заново. */
  deliveries?: PlannedDelivery[];
  resentFromId?: string | null;
  createdBy?: string | null;
}

export interface QueuedNotification {
  messageId: string;
  /** false — сообщение с таким dedupeKey уже было (повтор — no-op). */
  created: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DEDUPE_KEY = 300;

export function toNewDelivery(p: PlannedDelivery): NewDelivery {
  const first = p.chain[0];
  return {
    targetKind: p.targetKind,
    staffUserId: p.staffUserId,
    recipientName: p.recipientName,
    chain: p.chain,
    channel: first?.channel ?? p.requestedChannel,
    address: first?.address ?? '',
    status: first ? DeliveryStatus.Pending : DeliveryStatus.Failed,
    lastError: first ? null : 'no_recipient_address',
  };
}

function normalizeRecipient(recipient: MessageRecipient): MessageRecipient {
  if (recipient.kind !== 'guest') return recipient;
  const email = recipient.email?.trim().toLowerCase() ?? null;
  return {
    kind: 'guest',
    phone: tryNormalizePhone(recipient.phone),
    email: email && EMAIL_RE.test(email) ? email : null,
    name: recipient.name?.trim().slice(0, 120) || null,
  };
}

function normalizeParams(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null) out[key] = '';
    else out[key] = typeof value === 'string' ? value : String(value);
  }
  return out;
}

function normalizeAttachments(attachments: NotificationAttachment[] | undefined): NotificationAttachment[] {
  return (attachments ?? [])
    .filter((a) => a && typeof a.fileKey === 'string' && a.fileKey.trim().length > 0)
    .map((a) => ({
      fileKey: a.fileKey.trim(),
      filename: (a.filename || 'document').trim().slice(0, 200),
      contentType: a.contentType || 'application/octet-stream',
    }));
}

/**
 * Постановка уведомления в очередь: запись сообщения в ТЕКУЩЕЙ транзакции вызывающего кода
 * и задача доставки в outbox. Внешних вызовов нет — недоступность мессенджера не влияет на бизнес-операцию.
 * Повторный dedupeKey — no-op.
 */
@Injectable()
export class QueueNotification {
  private readonly logger = new Logger(QueueNotification.name);

  constructor(
    private readonly messages: MessageRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly secrets: MessageSecrets,
    private readonly jobs: JobQueue,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(input: QueueNotificationInput): Promise<QueuedNotification> {
    const info = templateInfo(input.template);
    if (!info || info.audience !== input.audience) {
      throw new ValidationError('notification.unknown_template', `Unknown ${input.audience} template ${input.template}`, {
        template: input.template,
      });
    }
    const now = this.clock.now();
    const params = normalizeParams(input.params);
    const { visible, secret } = splitSensitiveParams(params, info.sensitive);
    const attachments = normalizeAttachments(input.attachments);
    const recipient = normalizeRecipient(input.recipient);
    const channelPlan: ChannelPlan =
      recipient.kind === 'guest' && !input.deliveries ? guestChannelPlan(input.channels, attachments.length > 0) : [];
    let dedupeKey = input.dedupeKey?.trim() || null;
    if (dedupeKey && dedupeKey.length > MAX_DEDUPE_KEY) dedupeKey = `sha256:${sha256(dedupeKey)}`;

    return this.database.transaction(async () => {
      const id = newId();
      const inserted = await this.messages.insert({
        id,
        audience: input.audience,
        template: input.template,
        locale: parseLocale(input.locale),
        params: visible,
        secretParams: this.secrets.seal(secret),
        recipient,
        attachments,
        channelPlan,
        dedupeKey,
        relatedType: input.related?.type ?? null,
        relatedId: input.related?.id ?? null,
        branchId: input.branchId ?? null,
        resentFromId: input.resentFromId ?? null,
        createdBy: input.createdBy ?? null,
        expiresAt: new Date(now.getTime() + info.ttlMinutes * 60_000),
        createdAt: now,
      });
      if (!inserted) {
        const existing = dedupeKey ? await this.messages.findByDedupeKey(dedupeKey) : null;
        this.logger.debug({ dedupeKey, template: input.template }, 'Duplicate notification ignored');
        return { messageId: existing?.id ?? '', created: false };
      }
      if (input.deliveries) {
        await this.deliveries.insertMany(id, input.deliveries.map(toNewDelivery), now);
        await this.messages.markPlanned(id, now);
      }
      await this.jobs.enqueue<DeliverJobPayload>(DELIVER_JOB, { messageId: id }, { aggregateId: id, branchId: input.branchId ?? null });
      return { messageId: id, created: true };
    });
  }
}
