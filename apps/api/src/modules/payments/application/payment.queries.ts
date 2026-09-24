import { Injectable } from '@nestjs/common';
import { IntegrationLog } from '../../../shared/infrastructure/integrations/integration-log';
import { Actor } from '../../../shared/kernel/actor';
import { NotFoundError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { Page, PageRequest, pageRequest } from '../../../shared/kernel/pagination';
import { Permission } from '../../../shared/kernel/permissions';
import { Payment } from '../domain/payment';
import { RefundMode, reservedRefundTotal } from '../domain/refund';
import { PaymentListRow, PaymentRepository, PaymentSearchFilter } from '../infrastructure/payment.repository';
import { mapRefund, RefundListRow, RefundRepository } from '../infrastructure/refund.repository';
import { WebhookEventRepository } from '../infrastructure/webhook-event.repository';
import { PaymentMethod, PaymentPurpose, PaymentStatus, PaymentView, RefundStatus } from '../public';

export interface PaymentAdminView extends PaymentListRow {
  /** Флаги для админки (фронт не вычисляет бизнес-правила). */
  refundable: Money;
  canRefund: boolean;
  canCollect: boolean;
  allowedTransitions: readonly PaymentStatus[];
}

export interface PaymentProviderLogEntry {
  id: string;
  occurredAt: Date;
  integration: string;
  direction: string;
  operation: string;
  statusCode: number | null;
  success: boolean;
  durationMs: number | null;
  error: string | null;
  request: unknown;
  response: unknown;
}

export interface PaymentDetailsView {
  payment: PaymentAdminView;
  refunds: Array<RefundListRow & { mode: RefundMode }>;
  webhookEvents: Array<{ id: string; eventId: string; status: string; outcome: string; reportedAmount: Money | null; receivedAt: Date }>;
  providerLog: PaymentProviderLogEntry[];
}

export interface AdminPaymentFilter {
  branchId?: string;
  purpose?: PaymentPurpose;
  method?: PaymentMethod;
  provider?: string;
  status?: PaymentStatus;
  referenceId?: string;
  from?: Date;
  to?: Date;
}

/** Чтение платежей: контракт (getPayment, listForReference) и админка (списки с учётом прав по филиалу). */
@Injectable()
export class PaymentQueries {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly refunds: RefundRepository,
    private readonly webhookEvents: WebhookEventRepository,
    private readonly integrationLog: IntegrationLog,
  ) {}

  async get(paymentId: string): Promise<PaymentView> {
    const payment = await this.payments.findById(paymentId);
    if (!payment) throw new NotFoundError('payment', paymentId);
    return payment.toView();
  }

  async listForReference(purpose: PaymentPurpose, referenceId: string): Promise<PaymentView[]> {
    return (await this.payments.listForReference(purpose, referenceId)).map((p) => p.toView());
  }

  async search(actor: Actor, filter: AdminPaymentFilter, page: PageRequest): Promise<Page<PaymentAdminView>> {
    const branches = actor.scopeBranches(Permission.PaymentsView, filter.branchId);
    const search: PaymentSearchFilter = { ...filter, branches };
    const result = await this.payments.search(search, page);
    const items = await Promise.all(result.items.map((row) => this.adminView(actor, row)));
    return { ...result, items };
  }

  async details(actor: Actor, paymentId: string): Promise<PaymentDetailsView> {
    const row = await this.payments.findRow(paymentId);
    if (!row) throw new NotFoundError('payment', paymentId);
    actor.assertCan(Permission.PaymentsView, row.branch_id);
    const listRow = this.payments.listRow(row);
    const refundRows = await this.refunds.listRowsForPayment(paymentId);
    const events = await this.webhookEvents.listForPayment(paymentId);
    const log = await this.integrationLog.search({ correlationId: paymentId }, pageRequest(1, 100));
    return {
      payment: await this.adminView(actor, listRow),
      refunds: refundRows.map((r) => ({
        refund: mapRefund(r),
        mode: r.mode as RefundMode,
        paymentBranchId: row.branch_id,
        paymentPurpose: row.purpose,
        paymentReferenceId: row.reference_id,
        paymentMethod: row.method,
        attempts: r.attempts,
        failureReason: r.failure_reason,
        comment: r.comment,
        completedAt: r.completed_at,
      })),
      webhookEvents: events.map((e) => ({
        id: e.id,
        eventId: e.event_id,
        status: e.status,
        outcome: e.outcome,
        reportedAmount: e.reported_amount === null ? null : Money.of(Number(e.reported_amount), e.reported_currency as Money['currency']),
        receivedAt: e.received_at,
      })),
      // Журнал уже замаскирован при записи (платёжные данные, токены, подписи).
      providerLog: log.items.map((l: any) => ({
        id: l.id,
        occurredAt: l.occurred_at,
        integration: l.integration,
        direction: l.direction,
        operation: l.operation,
        statusCode: l.status_code,
        success: l.success,
        durationMs: l.duration_ms,
        error: l.error,
        request: l.request,
        response: l.response,
      })),
    };
  }

  async refundQueue(
    actor: Actor,
    filter: { branchId?: string; status?: RefundStatus; mode?: RefundMode },
    page: PageRequest,
  ): Promise<Page<RefundListRow & { mode: RefundMode }>> {
    const branches = actor.scopeBranches(Permission.PaymentsView, filter.branchId);
    const result = await this.refunds.search({ branches, status: filter.status, mode: filter.mode }, page);
    return { ...result, items: result.items.map((r) => ({ ...r, mode: r.refund.mode })) };
  }

  private async adminView(actor: Actor, row: PaymentListRow): Promise<PaymentAdminView> {
    const payment: Payment = row.payment;
    const reserved = reservedRefundTotal(await this.refunds.listForPayment(payment.id), payment.amount.currency);
    const refundable = payment.refundableRemainder(reserved);
    return {
      ...row,
      refundable,
      canRefund: refundable.isPositive() && actor.can(Permission.PaymentsRefund, payment.branchId),
      canCollect: payment.method === 'on_receipt' && payment.status === 'pending' && actor.can(Permission.PaymentsManual, payment.branchId),
      allowedTransitions: payment.allowedTransitions(),
    };
  }
}
