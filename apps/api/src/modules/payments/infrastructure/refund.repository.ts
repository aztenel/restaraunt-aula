import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { Refund, RefundMode, RefundProps } from '../domain/refund';
import { RefundStatus } from '../public';
import { moneyOf } from './payment.repository';
import { PaymentsTables, RefundsTable } from './payments.tables';

export function mapRefund(row: Selectable<RefundsTable>): Refund {
  const props: RefundProps = {
    id: row.id,
    paymentId: row.payment_id,
    amount: moneyOf(row.refund_amount, row.refund_currency),
    status: row.status as RefundStatus,
    mode: row.mode as RefundMode,
    reason: row.reason,
    idempotencyKey: row.idempotency_key,
    externalRefundId: row.external_refund_id,
    attempts: row.attempts,
    failureReason: row.failure_reason,
    comment: row.comment,
    requestedBy: row.requested_by,
    completedBy: row.completed_by,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
  return Refund.restore(props);
}

export interface RefundListRow {
  refund: Refund;
  paymentBranchId: string | null;
  paymentPurpose: string;
  paymentReferenceId: string;
  paymentMethod: string;
  attempts: number;
  failureReason: string | null;
  comment: string | null;
  completedAt: Date | null;
}

@Injectable()
export class RefundRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<PaymentsTables>();
  }

  async findById(id: string, options: { forUpdate?: boolean } = {}): Promise<Refund | null> {
    let q = this.db().selectFrom('payments.refunds').selectAll().where('id', '=', id);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? mapRefund(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<Refund | null> {
    const row = await this.db().selectFrom('payments.refunds').selectAll().where('idempotency_key', '=', key).executeTakeFirst();
    return row ? mapRefund(row) : null;
  }

  async listForPayment(paymentId: string): Promise<Refund[]> {
    const rows = await this.db()
      .selectFrom('payments.refunds')
      .selectAll()
      .where('payment_id', '=', paymentId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(mapRefund);
  }

  async listForPayments(paymentIds: readonly string[]): Promise<Refund[]> {
    if (paymentIds.length === 0) return [];
    const rows = await this.db()
      .selectFrom('payments.refunds')
      .selectAll()
      .where('payment_id', 'in', [...paymentIds])
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(mapRefund);
  }

  /** Сумма «занятых» возвратов (ожидающие + прошедшие) по платежам — одним запросом для списков. */
  async reservedByPayment(paymentIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (paymentIds.length === 0) return map;
    const rows = await this.db()
      .selectFrom('payments.refunds')
      .select((eb) => ['payment_id', eb.fn.sum<number>('refund_amount').as('reserved')])
      .where('payment_id', 'in', paymentIds)
      .where('status', '!=', 'failed')
      .groupBy('payment_id')
      .execute();
    for (const r of rows) map.set(r.payment_id, Number(r.reserved));
    return map;
  }

  async listRowsForPayment(paymentId: string): Promise<Array<Selectable<RefundsTable>>> {
    return this.db().selectFrom('payments.refunds').selectAll().where('payment_id', '=', paymentId).orderBy('created_at').execute();
  }

  async insert(refund: Refund): Promise<boolean> {
    const s = refund.snapshot();
    const row = await this.db()
      .insertInto('payments.refunds')
      .values({
        id: s.id,
        payment_id: s.paymentId,
        refund_amount: s.amount.amount,
        refund_currency: s.amount.currency,
        status: s.status,
        mode: s.mode,
        reason: s.reason,
        idempotency_key: s.idempotencyKey,
        external_refund_id: s.externalRefundId,
        attempts: s.attempts,
        claimed_at: null,
        failure_reason: s.failureReason,
        comment: s.comment,
        requested_by: s.requestedBy,
        completed_by: s.completedBy,
        completed_at: s.completedAt,
        created_at: s.createdAt,
      })
      .onConflict((oc) => oc.column('idempotency_key').doNothing())
      .returning('id')
      .executeTakeFirst();
    return !!row;
  }

  async save(refund: Refund): Promise<void> {
    const s = refund.snapshot();
    await this.db()
      .updateTable('payments.refunds')
      .set({
        status: s.status,
        external_refund_id: s.externalRefundId,
        failure_reason: s.failureReason,
        comment: s.comment,
        completed_by: s.completedBy,
        completed_at: s.completedAt,
        claimed_at: null,
      })
      .where('id', '=', s.id)
      .execute();
  }

  /**
   * Захват возврата на исполнение (аренда): защищает от двойного возврата у провайдера, если одну и ту же
   * задачу одновременно взяли два воркера. Пишется сразу (вне транзакции задачи). Возвращает номер попытки
   * или null, если возврат уже не ожидает исполнения или занят другим исполнителем.
   */
  async claim(id: string, now: Date, leaseMs: number): Promise<number | null> {
    const row = await this.database
      .rootConnection()
      .updateTable('payments.refunds')
      .set({ claimed_at: now, attempts: sql`attempts + 1` })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .where('mode', 'in', ['gateway', 'certificate'])
      .where((eb) => eb.or([eb('claimed_at', 'is', null), eb('claimed_at', '<', new Date(now.getTime() - leaseMs))]))
      .returning('attempts')
      .executeTakeFirst();
    return row ? Number(row.attempts) : null;
  }

  /** Провайдер принял возврат: фиксируется сразу (вне транзакции), чтобы повтор задачи не вернул деньги дважды. */
  async recordProviderAccepted(id: string, externalRefundId: string): Promise<void> {
    await this.database
      .rootConnection()
      .updateTable('payments.refunds')
      .set({ external_refund_id: externalRefundId })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .execute();
  }

  /** Снять аренду после неудачной попытки (задача уйдёт на повтор). */
  async release(id: string): Promise<void> {
    await this.database.rootConnection().updateTable('payments.refunds').set({ claimed_at: null }).where('id', '=', id).execute();
  }

  async search(
    filter: { branches: 'all' | string[]; status?: RefundStatus; mode?: RefundMode },
    page: PageRequest,
  ): Promise<Page<RefundListRow>> {
    let q = this.db()
      .selectFrom('payments.refunds as r')
      .innerJoin('payments.payments as p', 'p.id', 'r.payment_id');
    if (filter.branches !== 'all') {
      if (filter.branches.length === 0) return pageOf([], 0, page);
      q = q.where('p.branch_id', 'in', filter.branches);
    }
    if (filter.status) q = q.where('r.status', '=', filter.status);
    if (filter.mode) q = q.where('r.mode', '=', filter.mode);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q
      .selectAll('r')
      .select(['p.branch_id as p_branch_id', 'p.purpose as p_purpose', 'p.reference_id as p_reference_id', 'p.method as p_method'])
      .orderBy('r.created_at', 'desc')
      .limit(page.perPage)
      .offset(offsetOf(page))
      .execute();
    return pageOf(
      rows.map((r) => ({
        refund: mapRefund(r),
        paymentBranchId: r.p_branch_id,
        paymentPurpose: r.p_purpose,
        paymentReferenceId: r.p_reference_id,
        paymentMethod: r.p_method,
        attempts: r.attempts,
        failureReason: r.failure_reason,
        comment: r.comment,
        completedAt: r.completed_at,
      })),
      Number(total?.n ?? 0),
      page,
    );
  }
}
