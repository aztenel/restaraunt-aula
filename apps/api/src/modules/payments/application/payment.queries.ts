import { Injectable } from '@nestjs/common';
import { IntegrationLog } from '../../../shared/infrastructure/integrations/integration-log';
import { Actor } from '../../../shared/kernel/actor';
import { NotFoundError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { Page, PageRequest, pageRequest } from '../../../shared/kernel/pagination';
import { Permission } from '../../../shared/kernel/permissions';
import { tryNormalizePhone } from '../../../shared/kernel/phone';
import { StaffDirectory } from '../../identity/public';
import { Payment } from '../domain/payment';
import { RefundMode } from '../domain/refund';
import { PaymentListRow, PaymentRepository, PaymentSearchFilter, PaymentStatusHistoryEntry } from '../infrastructure/payment.repository';
import { mapRefund, RefundListRow, RefundRepository, RefundSearchFilter } from '../infrastructure/refund.repository';
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

/** Строка возврата для админки: с именами сотрудников, запросившего и подтвердившего (отклонившего). */
export type RefundAdminRow = RefundListRow & { mode: RefundMode; requestedByName: string | null; completedByName: string | null };

/** Событие истории платежа: переход статуса или событие возврата. */
export interface PaymentHistoryEvent {
  at: Date;
  type: 'status' | 'refund_requested' | 'refund_succeeded' | 'refund_failed';
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus | null;
  refundId: string | null;
  amount: Money | null;
  reason: string | null;
  actorName: string | null;
}

export interface PaymentDetailsView {
  payment: PaymentAdminView;
  history: PaymentHistoryEvent[];
  refunds: RefundAdminRow[];
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
  /** Телефон гостя (часть номера, от 4 цифр). */
  phone?: string;
}

/** Чтение платежей: контракт (getPayment, listForReference) и админка (списки с учётом прав по филиалу). */
@Injectable()
export class PaymentQueries {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly refunds: RefundRepository,
    private readonly webhookEvents: WebhookEventRepository,
    private readonly integrationLog: IntegrationLog,
    private readonly staff: StaffDirectory,
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
    const { phone, ...rest } = filter;
    const search: PaymentSearchFilter = { ...rest, branches, phoneDigits: phoneDigits(phone) };
    const result = await this.payments.search(search, page);
    const reserved = await this.refunds.reservedByPayment(result.items.map((r) => r.payment.id));
    return { ...result, items: result.items.map((row) => this.adminView(actor, row, reserved.get(row.payment.id) ?? 0)) };
  }

  async details(actor: Actor, paymentId: string): Promise<PaymentDetailsView> {
    const row = await this.payments.findRow(paymentId);
    if (!row) throw new NotFoundError('payment', paymentId);
    actor.assertCan(Permission.PaymentsView, row.branch_id);
    const listRow = this.payments.listRow(row);
    const refundRows = await this.refunds.listRowsForPayment(paymentId);
    const events = await this.webhookEvents.listForPayment(paymentId);
    const log = await this.integrationLog.search({ correlationId: paymentId }, pageRequest(1, 100));
    const reserved = await this.refunds.reservedByPayment([paymentId]);
    const refunds = await this.withNames(
      refundRows.map((r) => ({
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
    );
    return {
      payment: this.adminView(actor, listRow, reserved.get(paymentId) ?? 0),
      history: paymentHistory(await this.payments.statusHistory(paymentId), refunds),
      refunds,
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
    filter: { branchId?: string; status?: RefundStatus; mode?: RefundMode; from?: Date; to?: Date; q?: string },
    page: PageRequest,
  ): Promise<Page<RefundAdminRow>> {
    const branches = actor.scopeBranches(Permission.PaymentsView, filter.branchId);
    const search: RefundSearchFilter = { branches, status: filter.status, mode: filter.mode, from: filter.from, to: filter.to, ...refundQuery(filter.q) };
    const result = await this.refunds.search(search, page);
    return { ...result, items: await this.withNames(result.items.map((r) => ({ ...r, mode: r.refund.mode }))) };
  }

  private async withNames(rows: Array<RefundListRow & { mode: RefundMode }>): Promise<RefundAdminRow[]> {
    const names = await this.staff.names(rows.flatMap((r) => [r.refund.snapshot().requestedBy, r.refund.snapshot().completedBy]));
    return rows.map((r) => {
      const s = r.refund.snapshot();
      return {
        ...r,
        requestedByName: s.requestedBy ? (names.get(s.requestedBy) ?? null) : null,
        completedByName: s.completedBy ? (names.get(s.completedBy) ?? null) : null,
      };
    });
  }

  private adminView(actor: Actor, row: PaymentListRow, reservedAmount: number): PaymentAdminView {
    const payment: Payment = row.payment;
    const refundable = payment.refundableRemainder(Money.of(reservedAmount, payment.amount.currency));
    return {
      ...row,
      refundable,
      canRefund: refundable.isPositive() && actor.can(Permission.PaymentsRefund, payment.branchId),
      canCollect: payment.method === 'on_receipt' && payment.status === 'pending' && actor.can(Permission.PaymentsManual, payment.branchId),
      allowedTransitions: payment.allowedTransitions(),
    };
  }
}

/** Цифры телефона для частичного поиска (от 4 цифр); полный номер нормализуется (8/+7 → 7…). */
function phoneDigits(phone: string | undefined): string | undefined {
  const text = phone?.trim();
  if (!text) return undefined;
  const normalized = tryNormalizePhone(text);
  if (normalized) return normalized.replace(/\D/g, '').slice(-10);
  const digits = text.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-10) : undefined;
}

/**
 * Поиск в очереди возвратов: UUID — возврат, платёж или объект оплаты; число — сумма в тенге
 * (или тиынах, если с копейками: «1500» и «1500.50»); иначе — текст описания платежа
 * (номер заказа, брони, счёта).
 */
function refundQuery(q: string | undefined): Pick<RefundSearchFilter, 'id' | 'amount' | 'text'> {
  const text = q?.trim();
  if (!text) return {};
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return { id: text.toLowerCase() };
  const numeric = text.replace(/\s/g, '').replace(',', '.');
  if (/^\d+(\.\d{1,2})?$/.test(numeric)) return { amount: Math.round(Number(numeric) * 100), text };
  return { text };
}

/** История платежа: переходы статуса и события возвратов по времени. */
function paymentHistory(statuses: PaymentStatusHistoryEntry[], refunds: RefundAdminRow[]): PaymentHistoryEvent[] {
  const events: PaymentHistoryEvent[] = statuses.map((h) => ({
    at: h.occurredAt,
    type: 'status',
    fromStatus: h.from,
    toStatus: h.to,
    refundId: null,
    amount: null,
    reason: h.reason,
    actorName: h.actorKind === 'staff' ? h.actorName : null,
  }));
  for (const r of refunds) {
    const s = r.refund.snapshot();
    events.push({
      at: s.createdAt,
      type: 'refund_requested',
      fromStatus: null,
      toStatus: null,
      refundId: s.id,
      amount: s.amount,
      reason: s.reason,
      actorName: r.requestedByName,
    });
    if (s.status !== 'pending' && s.completedAt) {
      events.push({
        at: s.completedAt,
        type: s.status === 'succeeded' ? 'refund_succeeded' : 'refund_failed',
        fromStatus: null,
        toStatus: null,
        refundId: s.id,
        amount: s.amount,
        reason: s.status === 'failed' ? s.failureReason : s.comment,
        actorName: r.completedByName,
      });
    }
  }
  // При равном времени: запрос возврата → переход статуса → итог возврата.
  const rank: Record<PaymentHistoryEvent['type'], number> = { refund_requested: 0, status: 1, refund_succeeded: 2, refund_failed: 2 };
  return events
    .map((e, index) => ({ e, index }))
    .sort((a, b) => a.e.at.getTime() - b.e.at.getTime() || rank[a.e.type] - rank[b.e.type] || a.index - b.index)
    .map(({ e }) => e);
}
