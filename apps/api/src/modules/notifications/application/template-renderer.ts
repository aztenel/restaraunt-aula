import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../shared/kernel/errors';
import { Locale } from '../../../shared/kernel/translatable';
import { defaultTemplateText } from '../domain/default-templates';
import { renderText, textToHtml } from '../domain/render';
import { templateInfo, TemplateInfo, textChannelFor } from '../domain/templates';
import { TemplateRepository } from '../infrastructure/template.repository';
import { NotificationChannel } from '../public';
import { RenderedContent } from './channel-adapter';

export interface ResolvedTemplateText {
  channel: NotificationChannel;
  locale: Locale;
  subject: string | null;
  body: string;
  source: 'db' | 'default';
  updatedAt: Date | null;
}

/** Порядок языков при отсутствии текста на запрошенном: запрошенный, затем ru, kk, en. */
function localeFallbacks(locale: Locale): Locale[] {
  return [...new Set<Locale>([locale, 'ru', 'kk', 'en'])];
}

/**
 * Тексты шаблонов: запись в БД (отредактированная в админке) или стартовый текст из кода.
 * Канал без собственного текста использует текст подходящего канала (textChannelFor).
 */
@Injectable()
export class TemplateRenderer {
  constructor(private readonly templates: TemplateRepository) {}

  info(key: string): TemplateInfo {
    const info = templateInfo(key);
    if (!info) throw new NotFoundError('notification_template', key);
    return info;
  }

  async resolve(key: string, channel: NotificationChannel, locale: Locale): Promise<ResolvedTemplateText> {
    const info = this.info(key);
    const textChannel = textChannelFor(info, channel);
    const stored = await this.templates.forChannel(key, textChannel);
    for (const l of localeFallbacks(locale)) {
      const row = stored.find((r) => r.locale === l);
      if (row) return { channel: textChannel, locale: l, subject: row.subject, body: row.body, source: 'db', updatedAt: row.updatedAt };
      const def = defaultTemplateText(key, textChannel, l);
      if (def) return { channel: textChannel, locale: l, subject: def.subject ?? null, body: def.body, source: 'default', updatedAt: null };
    }
    throw new NotFoundError('notification_template', `${key}/${channel}/${locale}`);
  }

  /** Отрисовать сообщение для канала. Для email — тема и HTML-версия. */
  async render(key: string, channel: NotificationChannel, locale: Locale, params: Record<string, string>): Promise<RenderedContent> {
    const text = await this.resolve(key, channel, locale);
    return this.renderResolved(key, channel, text, params);
  }

  renderResolved(
    key: string,
    channel: NotificationChannel,
    text: Pick<ResolvedTemplateText, 'subject' | 'body' | 'locale'>,
    params: Record<string, string>,
  ): RenderedContent {
    const info = this.info(key);
    const body = renderText(text.body, params);
    if (channel !== 'email') return { subject: null, text: body, html: null };
    const titleLocale = text.locale === 'kk' ? 'kk' : 'ru';
    const subject = renderText(text.subject?.trim() ? text.subject : info.title[titleLocale], params).replace(/\s*\n\s*/g, ' ');
    return { subject, text: body, html: textToHtml(body, subject) };
  }
}
