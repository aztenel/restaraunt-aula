import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { newId } from '../../../shared/kernel/ids';
import { BanquetTables } from './banquet.tables';

/** Виды записей ленты заявки (заметки, звонки, статусы, документы, оплаты). */
export const ACTIVITY_KINDS = [
  'created',
  'note',
  'call',
  'contact',
  'meeting',
  'status_changed',
  'assigned',
  'details_updated',
  'venue_set',
  'venue_released',
  'quote_saved',
  'quote_sent',
  'quote_accepted',
  'prepayment_set',
  'invoice_issued',
  'invoice_cancelled',
  'payment_recorded',
  'refund_requested',
  'refund_recorded',
  'document_generated',
  'act_issued',
  'esf',
  'sla_breach',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Действия менеджера, которые он записывает в ленту вручную. Звонок/контакт/встреча — это ответ гостю (SLA). */
export const MANUAL_ACTIVITY_KINDS = ['note', 'call', 'contact', 'meeting'] as const;
export type ManualActivityKind = (typeof MANUAL_ACTIVITY_KINDS)[number];
export const RESPONSE_ACTIVITY_KINDS: readonly ActivityKind[] = ['call', 'contact', 'meeting'];

export interface ActivityRecord {
  id: string;
  requestId: string;
  kind: ActivityKind;
  text: string | null;
  data: Record<string, unknown>;
  authorKind: 'staff' | 'system' | 'guest';
  authorId: string | null;
  authorName: string;
  occurredAt: Date;
}

@Injectable()
export class ActivityRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<BanquetTables>();
  }

  async add(input: {
    requestId: string;
    kind: ActivityKind;
    text?: string | null;
    data?: Record<string, unknown>;
    actor: Actor;
    at: Date;
  }): Promise<string> {
    const id = newId();
    await this.db()
      .insertInto('banquet.request_activities')
      .values({
        id,
        request_id: input.requestId,
        kind: input.kind,
        text: input.text ?? null,
        data: JSON.stringify(input.data ?? {}),
        author_kind: input.actor.kind,
        author_id: input.actor.userId,
        author_name: input.actor.name,
        occurred_at: input.at,
      })
      .execute();
    return id;
  }

  async list(requestId: string, limit = 300): Promise<ActivityRecord[]> {
    const rows = await this.db()
      .selectFrom('banquet.request_activities')
      .selectAll()
      .where('request_id', '=', requestId)
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      requestId: r.request_id,
      kind: r.kind as ActivityKind,
      text: r.text,
      data: (r.data as Record<string, unknown>) ?? {},
      authorKind: r.author_kind as ActivityRecord['authorKind'],
      authorId: r.author_id,
      authorName: r.author_name,
      occurredAt: r.occurred_at,
    }));
  }
}
