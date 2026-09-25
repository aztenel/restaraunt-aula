import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { Page, PageRequest } from '../../../shared/kernel/pagination';
import { Permission } from '../../../shared/kernel/permissions';
import { tryNormalizePhone } from '../../../shared/kernel/phone';
import { Locale, LOCALES } from '../../../shared/kernel/translatable';
import { DeliveryStatus, MessageStatus } from '../domain/delivery';
import { defaultTemplateText } from '../domain/default-templates';
import { maskAddress, maskParams } from '../domain/masking';
import { usedVariables } from '../domain/render';
import { allTemplates, TemplateAudience, TemplateInfo, templateInfo } from '../domain/templates';
import { DeliveryLogFilter, DeliveryLogRow, DeliveryRepository, MessageRepository } from '../infrastructure/message.repository';
import { TemplateRecord, TemplateRepository } from '../infrastructure/template.repository';
import { NotificationChannel } from '../public';
import { ChannelRegistry, ChannelStatus } from './channel-registry';
import { assertCanManageTemplates } from './template.actions';

export interface TemplateTextView {
  channel: NotificationChannel;
  locale: Locale;
  subject: string | null;
  body: string;
  /** Текст изменён относительно стартового. */
  customized: boolean;
  /** Текст хранится в БД (иначе используется стартовый из кода). */
  stored: boolean;
  updatedAt: Date | null;
  variables: string[];
}

export interface TemplateView {
  key: string;
  audience: TemplateAudience;
  title: { ru: string; kk: string };
  params: string[];
  sensitiveParams: string[];
  optionalParams: string[];
  channels: NotificationChannel[];
  sample: Record<string, string>;
  texts: TemplateTextView[];
}

export interface DeliveryLogItem {
  id: string;
  messageId: string;
  template: string;
  audience: TemplateAudience;
  locale: Locale;
  channel: NotificationChannel;
  provider: string | null;
  recipient: string;
  recipientName: string | null;
  status: DeliveryStatus;
  messageStatus: MessageStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  related: { type: string; id: string } | null;
  resentFromId: string | null;
  branchId: string | null;
}

export interface DeliveryAttemptView {
  attemptNo: number;
  channel: NotificationChannel;
  provider: string | null;
  recipient: string;
  status: 'sent' | 'failed' | 'skipped';
  retryable: boolean;
  errorCode: string | null;
  error: string | null;
  externalId: string | null;
  durationMs: number | null;
  occurredAt: Date;
}

export interface DeliveryDetail extends DeliveryLogItem {
  chain: Array<{ channel: NotificationChannel; recipient: string }>;
  stepIndex: number;
  params: Record<string, string>;
  renderedSubject: string | null;
  renderedText: string | null;
  attemptLog: DeliveryAttemptView[];
}

function toTextView(info: TemplateInfo, channel: NotificationChannel, locale: Locale, stored: TemplateRecord | undefined): TemplateTextView | null {
  const def = defaultTemplateText(info.key, channel, locale);
  if (!stored && !def) return null;
  const subject = channel === 'email' ? (stored ? stored.subject : (def?.subject ?? null)) : null;
  const body = stored?.body ?? def!.body;
  const customized = !def || body !== def.body || (channel === 'email' && (subject ?? null) !== (def.subject ?? null));
  return {
    channel,
    locale,
    subject,
    body,
    customized,
    stored: !!stored,
    updatedAt: stored?.updatedAt ?? null,
    variables: [...new Set([...usedVariables(body), ...usedVariables(subject ?? '')])],
  };
}

function toLogItem(row: DeliveryLogRow): DeliveryLogItem {
  return {
    id: row.id,
    messageId: row.messageId,
    template: row.template,
    audience: row.audience,
    locale: row.locale,
    channel: row.channel,
    provider: row.provider,
    recipient: maskAddress(row.channel, row.address),
    recipientName: row.recipientName,
    status: row.status,
    messageStatus: row.messageStatus,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    deliveredAt: row.deliveredAt,
    readAt: row.readAt,
    related: row.relatedType && row.relatedId ? { type: row.relatedType, id: row.relatedId } : null,
    resentFromId: row.resentFromId,
    branchId: row.branchId,
  };
}

/** Минимум цифр во фрагменте телефона / символов во фрагменте email или id чата. */
export const RECIPIENT_FRAGMENT_MIN_DIGITS = 4;
export const RECIPIENT_FRAGMENT_MIN_LENGTH = 3;
const FULL_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_CHARS_RE = /^[\d\s()+-]+$/;

/**
 * Поиск адресата в журнале: полный телефон/email — точное совпадение (как раньше); фрагмент
 * (последние цифры телефона, часть email или id чата) — совпадение по части адреса.
 * В ответе адресаты остаются маской; слишком короткий фрагмент — ошибка notification.recipient_search_too_short.
 */
export function recipientSearch(value: string | undefined): Pick<DeliveryLogFilter, 'address' | 'addressContains'> {
  const raw = value?.trim();
  if (!raw) return {};
  if (FULL_EMAIL_RE.test(raw)) return { address: raw.toLowerCase() };
  const phone = tryNormalizePhone(raw);
  if (phone) return { address: phone };
  if (PHONE_CHARS_RE.test(raw)) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length < RECIPIENT_FRAGMENT_MIN_DIGITS) {
      throw new ValidationError('notification.recipient_search_too_short', `Recipient fragment must contain at least ${RECIPIENT_FRAGMENT_MIN_DIGITS} digits`, {
        minDigits: RECIPIENT_FRAGMENT_MIN_DIGITS,
      });
    }
    return { addressContains: digits };
  }
  if (raw.length < RECIPIENT_FRAGMENT_MIN_LENGTH) {
    throw new ValidationError('notification.recipient_search_too_short', `Recipient fragment must be at least ${RECIPIENT_FRAGMENT_MIN_LENGTH} characters`, {
      minLength: RECIPIENT_FRAGMENT_MIN_LENGTH,
    });
  }
  return { addressContains: raw.toLowerCase() };
}

/** Запросы админки модуля уведомлений (только чтение). */
@Injectable()
export class NotificationQueries {
  constructor(
    private readonly templates: TemplateRepository,
    private readonly messages: MessageRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly channels: ChannelRegistry,
  ) {}

  private async templateView(info: TemplateInfo, stored: TemplateRecord[]): Promise<TemplateView> {
    const texts: TemplateTextView[] = [];
    for (const channel of info.channels) {
      for (const locale of LOCALES) {
        const view = toTextView(
          info,
          channel,
          locale,
          stored.find((r) => r.channel === channel && r.locale === locale),
        );
        if (view) texts.push(view);
      }
    }
    return {
      key: info.key,
      audience: info.audience,
      title: info.title,
      params: info.params,
      sensitiveParams: info.sensitive,
      optionalParams: info.optional,
      channels: [...info.channels],
      sample: info.sample,
      texts,
    };
  }

  async listTemplates(actor: Actor): Promise<TemplateView[]> {
    assertCanManageTemplates(actor);
    const stored = await this.templates.all();
    const result: TemplateView[] = [];
    for (const info of allTemplates()) {
      result.push(await this.templateView(info, stored.filter((r) => r.key === info.key)));
    }
    return result;
  }

  async getTemplate(actor: Actor, key: string): Promise<TemplateView> {
    assertCanManageTemplates(actor);
    const info = templateInfo(key);
    if (!info) throw new NotFoundError('notification_template', key);
    return this.templateView(info, await this.templates.forKey(key));
  }

  async deliveryLog(actor: Actor, filter: DeliveryLogFilter & { recipient?: string }, page: PageRequest): Promise<Page<DeliveryLogItem>> {
    actor.assertCan(Permission.IntegrationsManage);
    const { recipient, ...rest } = filter;
    const result = await this.deliveries.search({ ...rest, ...recipientSearch(recipient) }, page);
    return { ...result, items: result.items.map(toLogItem) };
  }

  async deliveryDetail(actor: Actor, deliveryId: string): Promise<DeliveryDetail> {
    actor.assertCan(Permission.IntegrationsManage);
    const record = await this.deliveries.findById(deliveryId);
    if (!record) throw new NotFoundError('notification_delivery', deliveryId);
    const message = await this.messages.findById(record.messageId);
    if (!message) throw new NotFoundError('notification_message', record.messageId);
    const info = templateInfo(message.template);
    const attempts = await this.deliveries.attemptsOf(deliveryId);
    return {
      ...toLogItem({
        ...record,
        template: message.template,
        audience: message.audience,
        locale: message.locale,
        relatedType: message.relatedType,
        relatedId: message.relatedId,
        resentFromId: message.resentFromId,
        messageStatus: message.status,
        branchId: message.branchId,
      }),
      chain: record.chain.map((s) => ({ channel: s.channel, recipient: maskAddress(s.channel, s.address) })),
      stepIndex: record.stepIndex,
      params: maskParams(message.params, info?.sensitive ?? []),
      renderedSubject: record.renderedSubject,
      renderedText: record.renderedText,
      attemptLog: attempts.map((a) => ({
        attemptNo: a.attemptNo,
        channel: a.channel,
        provider: a.provider,
        recipient: a.addressMasked,
        status: a.status,
        retryable: a.retryable,
        errorCode: a.errorCode,
        error: a.error,
        externalId: a.externalId,
        durationMs: a.durationMs,
        occurredAt: a.occurredAt,
      })),
    };
  }

  async channelStatuses(actor: Actor): Promise<ChannelStatus[]> {
    actor.assertCan(Permission.IntegrationsManage);
    return this.channels.statuses();
  }
}
