import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { Locale } from '../../../shared/kernel/translatable';
import { DeliveryStatus, DeliveryStep, MessageStatus } from '../domain/delivery';
import { ChannelPlan, DeliveryTargetKind } from '../domain/delivery-plan';
import { TemplateAudience } from '../domain/templates';
import { NotificationAttachment, NotificationChannel } from '../public';
import { DeliveriesTable, MessagesTable, NotificationsTables } from './notifications.tables';

/** Адресат сообщения: гость, аудитория персонала (разрешается при доставке) или прямой адрес (повтор, тест). */
export type MessageRecipient =
  | { kind: 'guest'; phone: string | null; email: string | null; name: string | null }
  | { kind: 'staff'; branchId: string | null; permission: string | null; userIds: string[]; includeBranchChannels: boolean | null }
  | { kind: 'direct'; channel: NotificationChannel; address: string; name: string | null };

export interface MessageRecord {
  id: string;
  audience: TemplateAudience;
  template: string;
  locale: Locale;
  params: Record<string, string>;
  secretParams: string | null;
  recipient: MessageRecipient;
  attachments: NotificationAttachment[];
  channelPlan: ChannelPlan;
  status: MessageStatus;
  attempts: number;
  jobRuns: number;
  dedupeKey: string | null;
  relatedType: string | null;
  relatedId: string | null;
  branchId: string | null;
  resentFromId: string | null;
  createdBy: string | null;
  plannedAt: Date | null;
  lockedUntil: Date | null;
  expiresAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export interface NewMessage {
  id: string;
  audience: TemplateAudience;
  template: string;
  locale: Locale;
  params: Record<string, string>;
  secretParams: string | null;
  recipient: MessageRecipient;
  attachments: NotificationAttachment[];
  channelPlan: ChannelPlan;
  dedupeKey: string | null;
  relatedType: string | null;
  relatedId: string | null;
  branchId: string | null;
  resentFromId: string | null;
  createdBy: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface DeliveryRecord {
  id: string;
  messageId: string;
  targetKind: DeliveryTargetKind;
  staffUserId: string | null;
  recipientName: string | null;
  chain: DeliveryStep[];
  stepIndex: number;
  channel: NotificationChannel;
  address: string;
  provider: string | null;
  status: DeliveryStatus;
  attempts: number;
  channelAttempts: number;
  externalId: string | null;
  lastError: string | null;
  renderedSubject: string | null;
  renderedText: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NewDelivery {
  targetKind: DeliveryTargetKind;
  staffUserId: string | null;
  recipientName: string | null;
  chain: DeliveryStep[];
  /** Канал и адрес для записи без цепочки (адреса нет — доставка сразу неуспешна). */
  channel: NotificationChannel;
  address: string;
  status: DeliveryStatus;
  lastError: string | null;
}

export interface DeliveryAttemptRecord {
  id: string;
  deliveryId: string;
  attemptNo: number;
  channel: NotificationChannel;
  provider: string | null;
  addressMasked: string;
  status: 'sent' | 'failed' | 'skipped';
  retryable: boolean;
  errorCode: string | null;
  error: string | null;
  externalId: string | null;
  durationMs: number | null;
  occurredAt: Date;
}

export interface DeliveryLogFilter {
  status?: DeliveryStatus;
  channel?: NotificationChannel;
  template?: string;
  audience?: TemplateAudience;
  from?: Date;
  to?: Date;
  /** Точный адрес (нормализованный телефон, email или id чата). */
  address?: string;
  /** Часть адреса (цифры телефона, часть email/id чата в нижнем регистре). */
  addressContains?: string;
  relatedType?: string;
  relatedId?: string;
}

export interface DeliveryLogRow extends DeliveryRecord {
  template: string;
  audience: TemplateAudience;
  locale: Locale;
  relatedType: string | null;
  relatedId: string | null;
  resentFromId: string | null;
  messageStatus: MessageStatus;
  branchId: string | null;
}

function mapMessage(row: Selectable<MessagesTable>): MessageRecord {
  return {
    id: row.id,
    audience: row.audience as TemplateAudience,
    template: row.template,
    locale: row.locale as Locale,
    params: (row.params as Record<string, string>) ?? {},
    secretParams: row.secret_params,
    recipient: row.recipient as MessageRecipient,
    attachments: (row.attachments as NotificationAttachment[]) ?? [],
    channelPlan: (row.channel_plan as ChannelPlan) ?? [],
    status: row.status as MessageStatus,
    attempts: row.attempts,
    jobRuns: row.job_runs,
    dedupeKey: row.dedupe_key,
    relatedType: row.related_type,
    relatedId: row.related_id,
    branchId: row.branch_id,
    resentFromId: row.resent_from_id,
    createdBy: row.created_by,
    plannedAt: row.planned_at,
    lockedUntil: row.locked_until,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

function mapDelivery(row: Selectable<DeliveriesTable>): DeliveryRecord {
  return {
    id: row.id,
    messageId: row.message_id,
    targetKind: row.target_kind as DeliveryTargetKind,
    staffUserId: row.staff_user_id,
    recipientName: row.recipient_name,
    chain: (row.chain as DeliveryStep[]) ?? [],
    stepIndex: row.step_index,
    channel: row.channel as NotificationChannel,
    address: row.address,
    provider: row.provider,
    status: row.status as DeliveryStatus,
    attempts: row.attempts,
    channelAttempts: row.channel_attempts,
    externalId: row.external_id,
    lastError: row.last_error,
    renderedSubject: row.rendered_subject,
    renderedText: row.rendered_text,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

@Injectable()
export class MessageRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<NotificationsTables>();
  }

  /** Вставка сообщения. null — сообщение с таким dedupe_key уже есть (повтор — no-op). */
  async insert(message: NewMessage): Promise<string | null> {
    const row = await this.db()
      .insertInto('notifications.messages')
      .values({
        id: message.id,
        audience: message.audience,
        template: message.template,
        locale: message.locale,
        params: JSON.stringify(message.params),
        secret_params: message.secretParams,
        recipient: JSON.stringify(message.recipient),
        attachments: JSON.stringify(message.attachments),
        channel_plan: JSON.stringify(message.channelPlan),
        status: 'queued',
        dedupe_key: message.dedupeKey,
        related_type: message.relatedType,
        related_id: message.relatedId,
        branch_id: message.branchId,
        resent_from_id: message.resentFromId,
        created_by: message.createdBy,
        planned_at: null,
        locked_until: null,
        expires_at: message.expiresAt,
        completed_at: null,
        last_error: null,
        created_at: message.createdAt,
      })
      .onConflict((oc) => oc.column('dedupe_key').doNothing())
      .returning('id')
      .executeTakeFirst();
    return row?.id ?? null;
  }

  async findById(id: string): Promise<MessageRecord | null> {
    const row = await this.db().selectFrom('notifications.messages').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? mapMessage(row) : null;
  }

  async findByDedupeKey(key: string): Promise<MessageRecord | null> {
    const row = await this.db().selectFrom('notifications.messages').selectAll().where('dedupe_key', '=', key).executeTakeFirst();
    return row ? mapMessage(row) : null;
  }

  /**
   * Захват сообщения задачей доставки (аренда до leaseUntil), чтобы параллельный повтор той же задачи
   * не отправил сообщение дважды. null — сообщение уже доставлено или обрабатывается другим процессом.
   */
  async claim(id: string, now: Date, leaseUntil: Date): Promise<MessageRecord | null> {
    const row = await this.db()
      .updateTable('notifications.messages')
      .set({ locked_until: leaseUntil, job_runs: sql`job_runs + 1` })
      .where('id', '=', id)
      .where('status', '=', 'queued')
      .where((eb) => eb.or([eb('locked_until', 'is', null), eb('locked_until', '<=', now)]))
      .returningAll()
      .executeTakeFirst();
    return row ? mapMessage(row) : null;
  }

  async release(id: string): Promise<void> {
    await this.db().updateTable('notifications.messages').set({ locked_until: null }).where('id', '=', id).execute();
  }

  async markPlanned(id: string, at: Date): Promise<void> {
    await this.db().updateTable('notifications.messages').set({ planned_at: at }).where('id', '=', id).execute();
  }

  async addAttempts(id: string, count: number): Promise<void> {
    if (count <= 0) return;
    await this.db()
      .updateTable('notifications.messages')
      .set({ attempts: sql`attempts + ${count}` })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Завершить сообщение, если оно в очереди и незавершённых доставок нет (атомарно: параллельный
   * вебхук мог вернуть доставку в работу). false — сообщение не завершено.
   */
  async complete(id: string, status: MessageStatus, at: Date, lastError: string | null): Promise<boolean> {
    const row = await this.db()
      .updateTable('notifications.messages')
      .set({ status, completed_at: at, last_error: lastError })
      .where('id', '=', id)
      .where('status', '=', 'queued')
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('notifications.deliveries')
              .select('id')
              .where('message_id', '=', id)
              .where('status', '=', 'pending'),
          ),
        ),
      )
      .returning('id')
      .executeTakeFirst();
    return !!row;
  }

  /** Пересчитать итог уже завершённого сообщения (после асинхронной ошибки провайдера без резервного канала). */
  async setFinalStatus(id: string, status: MessageStatus, lastError: string | null): Promise<void> {
    await this.db().updateTable('notifications.messages').set({ status, last_error: lastError }).where('id', '=', id).execute();
  }

  /** Вернуть сообщение в очередь (провайдер сообщил об ошибке отправленного сообщения). */
  async reopen(id: string): Promise<void> {
    await this.db()
      .updateTable('notifications.messages')
      .set({ status: 'queued', completed_at: null, job_runs: 0 })
      .where('id', '=', id)
      .execute();
  }

  /** Удалить зашифрованные чувствительные параметры завершённых сообщений. */
  async purgeSecrets(completedBefore: Date): Promise<number> {
    const rows = await this.db()
      .updateTable('notifications.messages')
      .set({ secret_params: null })
      .where('secret_params', 'is not', null)
      .where('completed_at', '<', completedBefore)
      .where('status', '!=', 'queued')
      .returning('id')
      .execute();
    return rows.length;
  }
}

@Injectable()
export class DeliveryRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<NotificationsTables>();
  }

  async insertMany(messageId: string, deliveries: NewDelivery[], createdAt: Date): Promise<string[]> {
    if (deliveries.length === 0) return [];
    const rows = deliveries.map((d) => ({
      id: newId(),
      message_id: messageId,
      target_kind: d.targetKind,
      staff_user_id: d.staffUserId,
      recipient_name: d.recipientName,
      chain: JSON.stringify(d.chain),
      step_index: 0,
      channel: d.channel,
      address: d.address,
      provider: null,
      status: d.status,
      attempts: 0,
      channel_attempts: 0,
      external_id: null,
      last_error: d.lastError,
      rendered_subject: null,
      rendered_text: null,
      sent_at: null,
      delivered_at: null,
      read_at: null,
      created_at: createdAt,
    }));
    await this.db().insertInto('notifications.deliveries').values(rows).execute();
    return rows.map((r) => r.id);
  }

  async findById(id: string): Promise<DeliveryRecord | null> {
    const row = await this.db().selectFrom('notifications.deliveries').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? mapDelivery(row) : null;
  }

  async forMessage(messageId: string): Promise<DeliveryRecord[]> {
    const rows = await this.db()
      .selectFrom('notifications.deliveries')
      .selectAll()
      .where('message_id', '=', messageId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(mapDelivery);
  }

  async findByExternalId(provider: string, externalId: string): Promise<DeliveryRecord | null> {
    const row = await this.db()
      .selectFrom('notifications.deliveries')
      .selectAll()
      .where('provider', '=', provider)
      .where('external_id', '=', externalId)
      .executeTakeFirst();
    return row ? mapDelivery(row) : null;
  }

  async lockForUpdate(id: string): Promise<DeliveryRecord | null> {
    const row = await this.db().selectFrom('notifications.deliveries').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    return row ? mapDelivery(row) : null;
  }

  async save(
    id: string,
    patch: Partial<{
      stepIndex: number;
      channel: NotificationChannel;
      address: string;
      provider: string | null;
      status: DeliveryStatus;
      attempts: number;
      channelAttempts: number;
      externalId: string | null;
      lastError: string | null;
      renderedSubject: string | null;
      renderedText: string | null;
      sentAt: Date | null;
      deliveredAt: Date | null;
      readAt: Date | null;
    }>,
  ): Promise<void> {
    const set: Record<string, unknown> = {};
    const columns: Record<string, string> = {
      stepIndex: 'step_index',
      channel: 'channel',
      address: 'address',
      provider: 'provider',
      status: 'status',
      attempts: 'attempts',
      channelAttempts: 'channel_attempts',
      externalId: 'external_id',
      lastError: 'last_error',
      renderedSubject: 'rendered_subject',
      renderedText: 'rendered_text',
      sentAt: 'sent_at',
      deliveredAt: 'delivered_at',
      readAt: 'read_at',
    };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && columns[key]) set[columns[key]] = value;
    }
    if (Object.keys(set).length === 0) return;
    await this.db().updateTable('notifications.deliveries').set(set).where('id', '=', id).execute();
  }

  async insertAttempt(attempt: Omit<DeliveryAttemptRecord, 'id'> & { messageId: string }): Promise<void> {
    await this.db()
      .insertInto('notifications.delivery_attempts')
      .values({
        id: newId(),
        delivery_id: attempt.deliveryId,
        message_id: attempt.messageId,
        attempt_no: attempt.attemptNo,
        channel: attempt.channel,
        provider: attempt.provider,
        address_masked: attempt.addressMasked,
        status: attempt.status,
        retryable: attempt.retryable,
        error_code: attempt.errorCode,
        error: attempt.error ? attempt.error.slice(0, 2000) : null,
        external_id: attempt.externalId,
        duration_ms: attempt.durationMs,
        occurred_at: attempt.occurredAt,
      })
      .execute();
  }

  async nextAttemptNo(deliveryId: string): Promise<number> {
    const row = await this.db()
      .selectFrom('notifications.delivery_attempts')
      .select((eb) => eb.fn.max('attempt_no').as('n'))
      .where('delivery_id', '=', deliveryId)
      .executeTakeFirst();
    return Number(row?.n ?? 0) + 1;
  }

  async attemptsOf(deliveryId: string): Promise<DeliveryAttemptRecord[]> {
    const rows = await this.db()
      .selectFrom('notifications.delivery_attempts')
      .selectAll()
      .where('delivery_id', '=', deliveryId)
      .orderBy('attempt_no')
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      deliveryId: r.delivery_id,
      attemptNo: r.attempt_no,
      channel: r.channel as NotificationChannel,
      provider: r.provider,
      addressMasked: r.address_masked,
      status: r.status as DeliveryAttemptRecord['status'],
      retryable: r.retryable,
      errorCode: r.error_code,
      error: r.error,
      externalId: r.external_id,
      durationMs: r.duration_ms,
      occurredAt: r.occurred_at,
    }));
  }

  /** Журнал доставки: доставки с данными сообщения, новые сверху. */
  async search(filter: DeliveryLogFilter, page: PageRequest): Promise<Page<DeliveryLogRow>> {
    let q = this.db()
      .selectFrom('notifications.deliveries as d')
      .innerJoin('notifications.messages as m', 'm.id', 'd.message_id');
    if (filter.status) q = q.where('d.status', '=', filter.status);
    if (filter.channel) q = q.where('d.channel', '=', filter.channel);
    if (filter.template) q = q.where('m.template', '=', filter.template);
    if (filter.audience) q = q.where('m.audience', '=', filter.audience);
    if (filter.from) q = q.where('d.created_at', '>=', filter.from);
    if (filter.to) q = q.where('d.created_at', '<', filter.to);
    if (filter.address) q = q.where('d.address', '=', filter.address);
    if (filter.addressContains) {
      const pattern = `%${filter.addressContains.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      q = q.where(sql<boolean>`lower(d.address) like ${pattern}`);
    }
    if (filter.relatedType) q = q.where('m.related_type', '=', filter.relatedType);
    if (filter.relatedId) q = q.where('m.related_id', '=', filter.relatedId);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q
      .selectAll('d')
      .select([
        'm.template as m_template',
        'm.audience as m_audience',
        'm.locale as m_locale',
        'm.related_type as m_related_type',
        'm.related_id as m_related_id',
        'm.resent_from_id as m_resent_from_id',
        'm.status as m_status',
        'm.branch_id as m_branch_id',
      ])
      .orderBy('d.created_at', 'desc')
      .orderBy('d.id', 'desc')
      .limit(page.perPage)
      .offset(offsetOf(page))
      .execute();
    return pageOf(
      rows.map((r) => ({
        ...mapDelivery(r),
        template: r.m_template,
        audience: r.m_audience as TemplateAudience,
        locale: r.m_locale as Locale,
        relatedType: r.m_related_type,
        relatedId: r.m_related_id,
        resentFromId: r.m_resent_from_id,
        messageStatus: r.m_status as MessageStatus,
        branchId: r.m_branch_id,
      })),
      Number(total?.n ?? 0),
      page,
    );
  }
}
