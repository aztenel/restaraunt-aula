import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Translatable } from '../../../shared/kernel/translatable';
import { ConsentSource } from '../domain/consent';
import { ConsentKind } from '../public';
import { ConsentTextsTable, CustomersTables } from './customers.tables';

export interface ConsentRecord {
  id: string;
  customerId: string;
  kind: ConsentKind;
  granted: boolean;
  textVersion: string;
  source: ConsentSource;
  ip: string | null;
  recordedBy: string | null;
  recordedAt: Date;
}

export interface ConsentTextRecord {
  id: string;
  kind: ConsentKind;
  version: string;
  text: Translatable;
  publishedAt: Date;
  publishedBy: string | null;
}

function mapText(row: Selectable<ConsentTextsTable>): ConsentTextRecord {
  return {
    id: row.id,
    kind: row.kind as ConsentKind,
    version: row.version,
    text: (row.text ?? {}) as Translatable,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
  };
}

/** История согласий гостя (только добавление). */
@Injectable()
export class ConsentRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CustomersTables>();
  }

  async insert(record: ConsentRecord): Promise<void> {
    await this.db()
      .insertInto('customers.consents')
      .values({
        id: record.id,
        customer_id: record.customerId,
        kind: record.kind,
        granted: record.granted,
        text_version: record.textVersion,
        source: record.source,
        ip: record.ip,
        recorded_by: record.recordedBy,
        recorded_at: record.recordedAt,
      })
      .execute();
  }

  async listForCustomer(customerId: string, limit = 200): Promise<ConsentRecord[]> {
    const rows = await this.db()
      .selectFrom('customers.consents')
      .selectAll()
      .where('customer_id', '=', customerId)
      .orderBy('recorded_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      kind: r.kind as ConsentKind,
      granted: r.granted,
      textVersion: r.text_version,
      source: r.source as ConsentSource,
      ip: r.ip,
      recordedBy: r.recorded_by,
      recordedAt: r.recorded_at,
    }));
  }

  /** Обезличивание: IP в истории согласий — персональные данные, стирается (сама история остаётся). */
  async eraseIps(customerId: string): Promise<void> {
    await this.db().updateTable('customers.consents').set({ ip: null }).where('customer_id', '=', customerId).where('ip', 'is not', null).execute();
  }
}

/** Версии текстов согласий. Опубликованная версия не меняется. */
@Injectable()
export class ConsentTextRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CustomersTables>();
  }

  async insert(record: ConsentTextRecord): Promise<void> {
    await this.db()
      .insertInto('customers.consent_texts')
      .values({
        id: record.id,
        kind: record.kind,
        version: record.version,
        text: JSON.stringify(record.text),
        published_at: record.publishedAt,
        published_by: record.publishedBy,
      })
      .execute();
  }

  async find(kind: ConsentKind, version: string): Promise<ConsentTextRecord | null> {
    const row = await this.db()
      .selectFrom('customers.consent_texts')
      .selectAll()
      .where('kind', '=', kind)
      .where('version', '=', version)
      .executeTakeFirst();
    return row ? mapText(row) : null;
  }

  /** Действующая версия: последняя опубликованная к моменту now. */
  async current(kind: ConsentKind, now: Date): Promise<ConsentTextRecord | null> {
    const row = await this.db()
      .selectFrom('customers.consent_texts')
      .selectAll()
      .where('kind', '=', kind)
      .where('published_at', '<=', now)
      .orderBy('published_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? mapText(row) : null;
  }

  async list(kind?: ConsentKind): Promise<ConsentTextRecord[]> {
    let q = this.db().selectFrom('customers.consent_texts').selectAll();
    if (kind) q = q.where('kind', '=', kind);
    const rows = await q.orderBy('kind').orderBy('published_at', 'desc').orderBy('id', 'desc').execute();
    return rows.map(mapText);
  }
}
