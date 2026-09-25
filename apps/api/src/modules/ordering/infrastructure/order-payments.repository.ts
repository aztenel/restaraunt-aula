import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { Currency, Money } from '../../../shared/kernel/money';
import { OrderingTables } from './ordering.tables';

export type OrderPaymentKind = 'certificate' | 'online' | 'on_receipt';

export interface OrderPaymentLink {
  paymentId: string;
  orderId: string;
  kind: OrderPaymentKind;
  attempt: number;
  amount: Money;
  createdAt: Date;
}

export type OrderRefundKind = 'cancellation' | 'partial' | 'late_payment' | 'duplicate_payment' | 'external';
export type OrderRefundStatus = 'pending' | 'succeeded' | 'failed';

export interface OrderRefundRecord {
  refundId: string;
  orderId: string;
  paymentId: string;
  kind: OrderRefundKind;
  status: OrderRefundStatus;
  amount: Money;
  reason: string;
  requestedBy: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

/** Связи заказа с платежами модуля Payments и запрошенные по заказу возвраты. */
@Injectable()
export class OrderPaymentsRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<OrderingTables>();
  }

  async link(input: { paymentId: string; orderId: string; kind: OrderPaymentKind; attempt: number; amount: Money }): Promise<void> {
    await this.db()
      .insertInto('ordering.order_payments')
      .values({
        payment_id: input.paymentId,
        order_id: input.orderId,
        kind: input.kind,
        attempt: input.attempt,
        amount_amount: input.amount.amount,
        amount_currency: input.amount.currency,
      })
      .onConflict((oc) => oc.column('payment_id').doNothing())
      .execute();
  }

  async listForOrder(orderId: string): Promise<OrderPaymentLink[]> {
    const rows = await this.db()
      .selectFrom('ordering.order_payments')
      .selectAll()
      .where('order_id', '=', orderId)
      .orderBy('created_at')
      .orderBy('attempt')
      .execute();
    return rows.map((r) => ({
      paymentId: r.payment_id,
      orderId: r.order_id,
      kind: r.kind as OrderPaymentKind,
      attempt: r.attempt,
      amount: Money.of(r.amount_amount, r.amount_currency as Currency),
      createdAt: r.created_at,
    }));
  }

  async addRefund(input: {
    refundId: string;
    orderId: string;
    paymentId: string;
    kind: OrderRefundKind;
    status: OrderRefundStatus;
    amount: Money;
    reason: string;
    requestedBy: string | null;
  }): Promise<void> {
    await this.db()
      .insertInto('ordering.order_refunds')
      .values({
        refund_id: input.refundId,
        order_id: input.orderId,
        payment_id: input.paymentId,
        kind: input.kind,
        status: input.status,
        amount_amount: input.amount.amount,
        amount_currency: input.amount.currency,
        reason: input.reason,
        requested_by: input.requestedBy,
        completed_at: null,
      })
      .onConflict((oc) => oc.column('refund_id').doNothing())
      .execute();
  }

  async findRefund(refundId: string): Promise<OrderRefundRecord | null> {
    const row = await this.db().selectFrom('ordering.order_refunds').selectAll().where('refund_id', '=', refundId).executeTakeFirst();
    return row ? this.mapRefund(row) : null;
  }

  async setRefundStatus(refundId: string, status: OrderRefundStatus, at: Date): Promise<void> {
    await this.db()
      .updateTable('ordering.order_refunds')
      .set({ status, completed_at: status === 'pending' ? null : at })
      .where('refund_id', '=', refundId)
      .execute();
  }

  async refundsForOrder(orderId: string): Promise<OrderRefundRecord[]> {
    const rows = await this.db()
      .selectFrom('ordering.order_refunds')
      .selectAll()
      .where('order_id', '=', orderId)
      .orderBy('created_at')
      .execute();
    return rows.map((r) => this.mapRefund(r));
  }

  private mapRefund(r: {
    refund_id: string;
    order_id: string;
    payment_id: string;
    kind: string;
    status: string;
    amount_amount: number;
    amount_currency: string;
    reason: string;
    requested_by: string | null;
    created_at: Date;
    completed_at: Date | null;
  }): OrderRefundRecord {
    return {
      refundId: r.refund_id,
      orderId: r.order_id,
      paymentId: r.payment_id,
      kind: r.kind as OrderRefundKind,
      status: r.status as OrderRefundStatus,
      amount: Money.of(r.amount_amount, r.amount_currency as Currency),
      reason: r.reason,
      requestedBy: r.requested_by,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    };
  }
}
