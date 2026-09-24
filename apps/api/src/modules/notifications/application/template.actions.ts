import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { ForbiddenError, ValidationError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { Locale } from '../../../shared/kernel/translatable';
import { defaultTemplateText } from '../domain/default-templates';
import { unknownVariables } from '../domain/render';
import { SmsInfo, smsInfo } from '../domain/sms';
import { TemplateInfo, textChannelFor } from '../domain/templates';
import { TemplateRepository } from '../infrastructure/template.repository';
import { NotificationChannel } from '../public';
import { TemplateRenderer } from './template-renderer';

/** Тексты шаблонов правят администратор интеграций или контент-менеджер (тексты — контент). */
export function assertCanManageTemplates(actor: Actor): void {
  if (!actor.can(Permission.IntegrationsManage) && !actor.can(Permission.ContentManage)) {
    throw new ForbiddenError('access.forbidden', 'Permission integrations.manage or content.manage required', {
      permissions: [Permission.IntegrationsManage, Permission.ContentManage],
    });
  }
}

const BODY_LIMITS: Record<NotificationChannel, number> = { whatsapp: 1024, sms: 1000, telegram: 4096, email: 20_000 };

function assertChannel(info: TemplateInfo, channel: NotificationChannel): void {
  if (!info.channels.includes(channel)) {
    throw new ValidationError('notification_template.channel_not_supported', `Template ${info.key} has no ${channel} text`, {
      channel,
      channels: [...info.channels],
    });
  }
}

function validateText(info: TemplateInfo, channel: NotificationChannel, subject: string | null, body: string): void {
  if (!body.trim()) throw new ValidationError('notification_template.body_required', 'Template text is required');
  if (body.length > BODY_LIMITS[channel]) {
    throw new ValidationError('notification_template.too_long', `Text is longer than ${BODY_LIMITS[channel]} characters`, {
      limit: BODY_LIMITS[channel],
    });
  }
  if (channel === 'email' && !subject?.trim()) {
    throw new ValidationError('notification_template.subject_required', 'Email subject is required');
  }
  const unknown = [...unknownVariables(body, info.params), ...unknownVariables(subject ?? '', info.params)];
  if (unknown.length > 0) {
    throw new ValidationError('notification_template.unknown_variables', `Unknown variables: ${unknown.join(', ')}`, {
      variables: [...new Set(unknown)],
      allowed: info.params,
    });
  }
}

/** Изменить текст шаблона (канал x язык). Переменные — только параметры шаблона из контракта. */
@Injectable()
export class UpdateTemplateText {
  constructor(
    private readonly renderer: TemplateRenderer,
    private readonly templates: TemplateRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, input: { key: string; channel: NotificationChannel; locale: Locale; subject?: string | null; body: string }) {
    assertCanManageTemplates(actor);
    const info = this.renderer.info(input.key);
    assertChannel(info, input.channel);
    const subject = input.channel === 'email' ? (input.subject?.trim() ?? null) : null;
    const body = input.body.replace(/\r\n?/g, '\n').trim();
    validateText(info, input.channel, subject, body);
    const before = await this.templates.find(input.key, input.channel, input.locale);
    const beforeText = before ?? defaultTemplateText(input.key, input.channel, input.locale);
    await this.database.transaction(async () => {
      await this.templates.upsert({ key: input.key, channel: input.channel, locale: input.locale, subject, body, updatedBy: actor.userId });
      await this.audit.record({
        action: 'notification_template.updated',
        entityType: 'notification_template',
        entityId: `${input.key}/${input.channel}/${input.locale}`,
        before: beforeText ? { subject: beforeText.subject ?? null, body: beforeText.body } : null,
        after: { subject, body },
      });
    });
    return this.renderer.resolve(input.key, input.channel, input.locale);
  }
}

/** Вернуть стартовый текст шаблона. */
@Injectable()
export class ResetTemplateText {
  constructor(
    private readonly renderer: TemplateRenderer,
    private readonly templates: TemplateRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, input: { key: string; channel: NotificationChannel; locale: Locale }) {
    assertCanManageTemplates(actor);
    const info = this.renderer.info(input.key);
    assertChannel(info, input.channel);
    const def = defaultTemplateText(input.key, input.channel, input.locale);
    if (!def) {
      throw new ValidationError('notification_template.no_default', `No default text for ${input.key}/${input.channel}/${input.locale}`);
    }
    const before = await this.templates.find(input.key, input.channel, input.locale);
    await this.database.transaction(async () => {
      await this.templates.upsert({
        key: input.key,
        channel: input.channel,
        locale: input.locale,
        subject: def.subject ?? null,
        body: def.body,
        updatedBy: actor.userId,
      });
      await this.audit.record({
        action: 'notification_template.reset',
        entityType: 'notification_template',
        entityId: `${input.key}/${input.channel}/${input.locale}`,
        before: before ? { subject: before.subject, body: before.body } : null,
        after: { subject: def.subject ?? null, body: def.body },
      });
    });
    return this.renderer.resolve(input.key, input.channel, input.locale);
  }
}

export interface TemplatePreview {
  channel: NotificationChannel;
  locale: Locale;
  subject: string | null;
  text: string;
  html: string | null;
  unknownVariables: string[];
  length: number;
  sms: SmsInfo | null;
}

/**
 * Предпросмотр: сохранённый текст или черновик из формы, с примером параметров (или своими значениями).
 * Неизвестные переменные не блокируют предпросмотр — возвращаются списком для подсветки.
 */
@Injectable()
export class PreviewTemplate {
  constructor(private readonly renderer: TemplateRenderer) {}

  async execute(
    actor: Actor,
    input: { key: string; channel: NotificationChannel; locale: Locale; subject?: string | null; body?: string | null; params?: Record<string, string> },
  ): Promise<TemplatePreview> {
    assertCanManageTemplates(actor);
    const info = this.renderer.info(input.key);
    const extra = Object.keys(input.params ?? {}).filter((k) => !info.params.includes(k));
    if (extra.length > 0) {
      throw new ValidationError('notification_template.unknown_params', `Unknown parameters: ${extra.join(', ')}`, {
        params: extra,
        allowed: info.params,
      });
    }
    const params = { ...info.sample, ...(input.params ?? {}) };
    const stored = await this.renderer.resolve(input.key, input.channel, input.locale);
    const draft = input.body !== undefined && input.body !== null;
    const body = draft ? input.body! : stored.body;
    const subjectSource = input.channel === 'email' ? (input.subject !== undefined && input.subject !== null ? input.subject : stored.subject) : null;
    const unknown = [...new Set([...unknownVariables(body, info.params), ...unknownVariables(subjectSource ?? '', info.params)])];
    const rendered = this.renderer.renderResolved(input.key, input.channel, { subject: subjectSource, body, locale: input.locale }, params);
    const textChannel = textChannelFor(info, input.channel);
    return {
      channel: textChannel,
      locale: input.locale,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      unknownVariables: unknown,
      length: rendered.text.length,
      sms: input.channel === 'sms' ? smsInfo(rendered.text) : null,
    };
  }
}
