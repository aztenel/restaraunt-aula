import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Money } from '../../../shared/kernel/money';
import { ReportPeriod } from '../domain/period';
import { PaymentPurposeCode } from '../domain/revenue';
import { ReportingTables } from './reporting.tables';
import { branchFilter, inPeriod } from './sql-helpers';

export interface PaymentFact {
  paymentId: string;
  purpose: PaymentPurposeCode;
  referenceId: string;
  branchId: string | null;
  method: string;
  provider: string;
  amount: Money;
  paidAt: Date;
  paidDate: string;
  late: boolean;
}

export interface RefundFact {
  refundId: string;
  paymentId: string;
  purpose: PaymentPurposeCode;
  referenceId: string;
  branchId: string | null;
  amount: Money;
  reason: string;
  refundedAt: Date;
  refundedDate: string;
  paymentFullyRefunded: boolean;
  referenceFullyRefunded: boolean;
}

/** Проекция поступлений и возвратов (события Payments) — отчёт «Движение денег». */
@Injectable()
export class PaymentFactsRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReportingTables>();
  }

  async insertPayment(p: PaymentFact): Promise<void> {
    await this.db()
      .insertInto('reporting.payments')
      .values({
        payment_id: p.paymentId,
        purpose: p.purpose,
        reference_id: p.referenceId,
        branch_id: p.branchId,
        method: p.method,
        provider: p.provider,
        payment_amount: p.amount.amount,
        payment_currency: p.amount.currency,
        paid_at: p.paidAt,
        paid_date: p.paidDate,
        late: p.late,
      })
      .onConflict((oc) => oc.column('payment_id').doNothing())
      .execute();
  }

  async insertRefund(r: RefundFact): Promise<void> {
    await this.db()
      .insertInto('reporting.refunds')
      .values({
        refund_id: r.refundId,
        payment_id: r.paymentId,
        purpose: r.purpose,
        reference_id: r.referenceId,
        branch_id: r.branchId,
        refund_amount: r.amount.amount,
        refund_currency: r.amount.currency,
        reason: r.reason,
        refunded_at: r.refundedAt,
        refunded_date: r.refundedDate,
        payment_fully_refunded: r.paymentFullyRefunded,
        reference_fully_refunded: r.referenceFullyRefunded,
      })
      .onConflict((oc) => oc.column('refund_id').doNothing())
      .execute();
  }

  private mapRefund(r: {
    refund_id: string;
    payment_id: string;
    purpose: string;
    reference_id: string;
    branch_id: string | null;
    refund_amount: number;
    reason: string;
    refunded_at: Date;
    refunded_date: string;
    payment_fully_refunded: boolean;
    reference_fully_refunded: boolean;
  }): RefundFact {
    return {
      refundId: r.refund_id,
      paymentId: r.payment_id,
      purpose: r.purpose as PaymentPurposeCode,
      referenceId: r.reference_id,
      branchId: r.branch_id,
      amount: Money.of(r.refund_amount),
      reason: r.reason,
      refundedAt: r.refunded_at,
      refundedDate: r.refunded_date,
      paymentFullyRefunded: r.payment_fully_refunded,
      referenceFullyRefunded: r.reference_fully_refunded,
    };
  }

  /** Способ оплаты платежа (для возвратов: деньги или сертификат). */
  async methodOf(paymentId: string): Promise<string | null> {
    const row = await this.db().selectFrom('reporting.payments').select('method').where('payment_id', '=', paymentId).executeTakeFirst();
    return row?.method ?? null;
  }

  /** Сколько по объекту оплачено данным способом (например, сертификатом по заказу). */
  async capturedAmount(purpose: PaymentPurposeCode, referenceId: string, method: string): Promise<Money> {
    const row = await this.db()
      .selectFrom('reporting.payments')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('payment_amount'), sql<number>`0`).as('amount'))
      .where('purpose', '=', purpose)
      .where('reference_id', '=', referenceId)
      .where('method', '=', method)
      .executeTakeFirst();
    return Money.of(Number(row?.amount ?? 0));
  }

  async findRefund(refundId: string): Promise<RefundFact | null> {
    const row = await this.db().selectFrom('reporting.refunds').selectAll().where('refund_id', '=', refundId).executeTakeFirst();
    return row ? this.mapRefund(row) : null;
  }

  /** Возвраты по объектам (заказ, счёт банкета, …). */
  async refundsFor(purpose: PaymentPurposeCode, referenceIds: readonly string[]): Promise<RefundFact[]> {
    if (referenceIds.length === 0) return [];
    const rows = await this.db()
      .selectFrom('reporting.refunds')
      .selectAll()
      .where('purpose', '=', purpose)
      .where('reference_id', 'in', [...referenceIds])
      .orderBy('refunded_at')
      .execute();
    return rows.map((r) => this.mapRefund(r));
  }

  // ---------------------------------------------------------------- отчёты

  /** Поступления и возвраты по способу оплаты и провайдеру. */
  async byMethod(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{
      method: string;
      provider: string;
      received: number;
      received_count: number;
      refunded: number;
      refunded_count: number;
    }>`
      with inflow as (
        select method, provider, sum(payment_amount)::bigint as amount, count(*) as n
        from reporting.payments
        where ${inPeriod('paid_date', period)} and ${branchFilter('branch_id', branchIds)}
        group by method, provider
      ),
      outflow as (
        select coalesce(p.method, 'unknown') as method, coalesce(p.provider, 'unknown') as provider,
               sum(r.refund_amount)::bigint as amount, count(*) as n
        from reporting.refunds r
        left join reporting.payments p on p.payment_id = r.payment_id
        where ${inPeriod('r.refunded_date', period)} and ${branchFilter('r.branch_id', branchIds)}
        group by 1, 2
      )
      select coalesce(i.method, o.method) as method, coalesce(i.provider, o.provider) as provider,
             coalesce(i.amount, 0)::bigint as received, coalesce(i.n, 0) as received_count,
             coalesce(o.amount, 0)::bigint as refunded, coalesce(o.n, 0) as refunded_count
      from inflow i
      full join outflow o on o.method = i.method and o.provider = i.provider
      order by 1, 2
    `.execute(this.db());
    return result.rows.map((r) => ({
      method: r.method,
      provider: r.provider,
      received: Money.of(Number(r.received)),
      receivedCount: Number(r.received_count),
      refunded: Money.of(Number(r.refunded)),
      refundedCount: Number(r.refunded_count),
    }));
  }

  /** Поступления и возвраты по назначению платежа (заказ, депозит, счёт банкета, сертификат). */
  async byPurpose(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ purpose: string; received: number; refunded: number }>`
      with inflow as (
        select purpose, sum(payment_amount)::bigint as amount from reporting.payments
        where ${inPeriod('paid_date', period)} and ${branchFilter('branch_id', branchIds)}
        group by purpose
      ),
      outflow as (
        select purpose, sum(refund_amount)::bigint as amount from reporting.refunds
        where ${inPeriod('refunded_date', period)} and ${branchFilter('branch_id', branchIds)}
        group by purpose
      )
      select coalesce(i.purpose, o.purpose) as purpose, coalesce(i.amount, 0)::bigint as received, coalesce(o.amount, 0)::bigint as refunded
      from inflow i full join outflow o on o.purpose = i.purpose
      order by 1
    `.execute(this.db());
    return result.rows.map((r) => ({ purpose: r.purpose, received: Money.of(Number(r.received)), refunded: Money.of(Number(r.refunded)) }));
  }

  async byDay(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ date: string; received: number; refunded: number }>`
      with inflow as (
        select paid_date as date, sum(payment_amount)::bigint as amount from reporting.payments
        where ${inPeriod('paid_date', period)} and ${branchFilter('branch_id', branchIds)}
        group by paid_date
      ),
      outflow as (
        select refunded_date as date, sum(refund_amount)::bigint as amount from reporting.refunds
        where ${inPeriod('refunded_date', period)} and ${branchFilter('branch_id', branchIds)}
        group by refunded_date
      )
      select coalesce(i.date, o.date) as date, coalesce(i.amount, 0)::bigint as received, coalesce(o.amount, 0)::bigint as refunded
      from inflow i full join outflow o on o.date = i.date
    `.execute(this.db());
    return result.rows.map((r) => ({ date: r.date, received: Money.of(Number(r.received)), refunded: Money.of(Number(r.refunded)) }));
  }

  /** Успешные платежи по заказам (для разбивки оплат в выгрузке в учёт). */
  async orderPayments(orderIds: readonly string[]) {
    if (orderIds.length === 0) return [];
    const rows = await this.db()
      .selectFrom('reporting.payments')
      .select(['reference_id', 'method', 'payment_amount'])
      .where('purpose', '=', 'order')
      .where('reference_id', 'in', [...orderIds])
      .orderBy('paid_at')
      .execute();
    return rows.map((r) => ({ orderId: r.reference_id, method: r.method, amount: Money.of(r.payment_amount) }));
  }
}
