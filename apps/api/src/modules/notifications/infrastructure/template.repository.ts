import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';
import { Locale } from '../../../shared/kernel/translatable';
import { NotificationChannel } from '../public';
import { NotificationsTables } from './notifications.tables';

export interface TemplateRecord {
  id: string;
  key: string;
  channel: NotificationChannel;
  locale: Locale;
  subject: string | null;
  body: string;
  updatedBy: string | null;
  updatedAt: Date;
}

@Injectable()
export class TemplateRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<NotificationsTables>();
  }

  private map(row: {
    id: string;
    key: string;
    channel: string;
    locale: string;
    subject: string | null;
    body: string;
    updated_by: string | null;
    updated_at: Date;
  }): TemplateRecord {
    return {
      id: row.id,
      key: row.key,
      channel: row.channel as NotificationChannel,
      locale: row.locale as Locale,
      subject: row.subject,
      body: row.body,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    };
  }

  async find(key: string, channel: NotificationChannel, locale: Locale): Promise<TemplateRecord | null> {
    const row = await this.db()
      .selectFrom('notifications.templates')
      .selectAll()
      .where('key', '=', key)
      .where('channel', '=', channel)
      .where('locale', '=', locale)
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async forChannel(key: string, channel: NotificationChannel): Promise<TemplateRecord[]> {
    const rows = await this.db()
      .selectFrom('notifications.templates')
      .selectAll()
      .where('key', '=', key)
      .where('channel', '=', channel)
      .execute();
    return rows.map((r) => this.map(r));
  }

  async forKey(key: string): Promise<TemplateRecord[]> {
    const rows = await this.db().selectFrom('notifications.templates').selectAll().where('key', '=', key).execute();
    return rows.map((r) => this.map(r));
  }

  async all(): Promise<TemplateRecord[]> {
    const rows = await this.db().selectFrom('notifications.templates').selectAll().orderBy('key').execute();
    return rows.map((r) => this.map(r));
  }

  async upsert(input: {
    key: string;
    channel: NotificationChannel;
    locale: Locale;
    subject: string | null;
    body: string;
    updatedBy: string | null;
  }): Promise<void> {
    await this.db()
      .insertInto('notifications.templates')
      .values({
        id: newId(),
        key: input.key,
        channel: input.channel,
        locale: input.locale,
        subject: input.subject,
        body: input.body,
        updated_by: input.updatedBy,
      })
      .onConflict((oc) =>
        oc.columns(['key', 'channel', 'locale']).doUpdateSet({ subject: input.subject, body: input.body, updated_by: input.updatedBy }),
      )
      .execute();
  }

  /** Вставить отсутствующие тексты (сид): существующие, в том числе отредактированные, не меняются. */
  async insertMissing(
    rows: Array<{ key: string; channel: NotificationChannel; locale: Locale; subject: string | null; body: string }>,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const inserted = await this.db()
      .insertInto('notifications.templates')
      .values(rows.map((r) => ({ id: newId(), key: r.key, channel: r.channel, locale: r.locale, subject: r.subject, body: r.body, updated_by: null })))
      .onConflict((oc) => oc.columns(['key', 'channel', 'locale']).doNothing())
      .returning('id')
      .execute();
    return inserted.length;
  }
}
