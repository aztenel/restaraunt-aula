import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../../../../shared/infrastructure/database/database';
import { Money } from '../../../../../shared/kernel/money';
import { moneyOf } from '../../payment.repository';
import { PaymentsTables } from '../../payments.tables';

export type SandboxSessionStatus = 'pending' | 'succeeded' | 'failed';

export interface SandboxSession {
  externalId: string;
  paymentId: string;
  amount: Money;
  status: SandboxSessionStatus;
  refunded: Money;
}

/** «Сторона провайдера» песочницы: состояние тестовых платежей (для опроса статуса и возвратов). */
@Injectable()
export class SandboxStore {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<PaymentsTables>();
  }

  async open(externalId: string, paymentId: string, amount: Money): Promise<void> {
    await this.db()
      .insertInto('payments.sandbox_sessions')
      .values({
        external_id: externalId,
        payment_id: paymentId,
        session_amount: amount.amount,
        session_currency: amount.currency,
        status: 'pending',
        refunded_amount: 0,
        refunded_currency: amount.currency,
      })
      .onConflict((oc) => oc.column('external_id').doNothing())
      .execute();
  }

  async get(externalId: string): Promise<SandboxSession | null> {
    const row = await this.db().selectFrom('payments.sandbox_sessions').selectAll().where('external_id', '=', externalId).executeTakeFirst();
    if (!row) return null;
    return {
      externalId: row.external_id,
      paymentId: row.payment_id,
      amount: moneyOf(row.session_amount, row.session_currency),
      status: row.status as SandboxSessionStatus,
      refunded: moneyOf(row.refunded_amount, row.refunded_currency),
    };
  }

  async setStatus(externalId: string, status: SandboxSessionStatus): Promise<void> {
    await this.db().updateTable('payments.sandbox_sessions').set({ status }).where('external_id', '=', externalId).execute();
  }

  /** Возврат на «стороне провайдера»: не больше оплаченного. */
  async refund(externalId: string, amount: Money): Promise<boolean> {
    const res = await this.db()
      .updateTable('payments.sandbox_sessions')
      .set({ refunded_amount: sql`refunded_amount + ${amount.amount}` })
      .where('external_id', '=', externalId)
      .where('status', '=', 'succeeded')
      .where(sql<boolean>`refunded_amount + ${amount.amount} <= session_amount`)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }
}
