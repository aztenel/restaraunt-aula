import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { PaymentsTables, WebhookEventsTable } from './payments.tables';

export type WebhookOutcome = 'applied' | 'ignored' | 'unknown_payment' | 'amount_mismatch';

/**
 * Входящие уведомления провайдеров. Уникальность (provider, event_id) — основа идемпотентности:
 * повторный вебхук с тем же идентификатором не меняет состояние второй раз.
 */
@Injectable()
export class WebhookEventRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<PaymentsTables>();
  }

  /** Зарегистрировать событие. false — такое событие уже обработано (дубликат). */
  async register(input: {
    provider: string;
    eventId: string;
    externalId: string;
    status: string;
    amount: Money | null;
    receivedAt: Date;
  }): Promise<string | null> {
    const id = newId();
    const row = await this.db()
      .insertInto('payments.webhook_events')
      .values({
        id,
        provider: input.provider,
        event_id: input.eventId.slice(0, 200),
        payment_id: null,
        external_id: input.externalId,
        status: input.status,
        reported_amount: input.amount?.amount ?? null,
        reported_currency: input.amount?.currency ?? 'KZT',
        outcome: 'ignored',
        received_at: input.receivedAt,
      })
      .onConflict((oc) => oc.columns(['provider', 'event_id']).doNothing())
      .returning('id')
      .executeTakeFirst();
    return row ? id : null;
  }

  async complete(id: string, paymentId: string | null, outcome: WebhookOutcome): Promise<void> {
    await this.db().updateTable('payments.webhook_events').set({ payment_id: paymentId, outcome }).where('id', '=', id).execute();
  }

  async listForPayment(paymentId: string): Promise<Array<Selectable<WebhookEventsTable>>> {
    return this.db()
      .selectFrom('payments.webhook_events')
      .selectAll()
      .where('payment_id', '=', paymentId)
      .orderBy('received_at', 'desc')
      .limit(100)
      .execute();
  }
}
