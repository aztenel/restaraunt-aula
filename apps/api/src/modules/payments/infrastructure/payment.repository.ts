import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { RequestContext } from '../../../shared/infrastructure/context/request-context';
import { Database } from '../../../shared/infrastructure/database/database';
import { Clock } from '../../../shared/kernel/clock';
import { newId } from '../../../shared/kernel/ids';
import { Currency, Money } from '../../../shared/kernel/money';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { Payment, PaymentProps } from '../domain/payment';
import { PaymentMethod, PaymentPurpose, PaymentStatus } from '../public';
import { PaymentsTable, PaymentsTables } from './payments.tables';

export function moneyOf(amount: number, currency: string): Money {
  return Money.of(Number(amount), currency.trim() as Currency);
}

export function mapPayment(row: Selectable<PaymentsTable>): Payment {
  const props: PaymentProps = {
    id: row.id,
    invoiceNo: Number(row.invoice_no),
    purpose: row.purpose as PaymentPurpose,
    referenceId: row.reference_id,
    branchId: row.branch_id,
    method: row.method as PaymentMethod,
    provider: row.provider,
    status: row.status as PaymentStatus,
    amount: moneyOf(row.payment_amount, row.payment_currency),
    refunded: moneyOf(row.refunded_amount, row.refunded_currency),
    externalId: row.external_id,
    paymentUrl: row.payment_url,
    providerData: (row.provider_data as Record<string, unknown>) ?? {},
    description: row.description,
    customer: { phone: row.customer_phone, name: row.customer_name, email: row.customer_email },
    returnUrl: row.return_url,
    idempotencyKey: row.idempotency_key,
    certificateId: row.certificate_id,
    documentNumber: row.document_number,
    failureReason: row.failure_reason,
    cancelReason: row.cancel_reason,
    initiateAttempts: row.initiate_attempts,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    failedAt: row.failed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
  };
  return Payment.restore(props);
}

export interface PaymentSearchFilter {
  /** 'all' — без ограничения по филиалу; иначе список филиалов (платежи без филиала не входят). */
  branches: 'all' | string[];
  purpose?: PaymentPurpose;
  method?: PaymentMethod;
  provider?: string;
  status?: PaymentStatus;
  referenceId?: string;
  from?: Date;
  to?: Date;
  /** Телефон гостя (цифры, от 4): частичное совпадение по нормализованному номеру. */
  phoneDigits?: string;
}

/** Запись истории статусов платежа. */
export interface PaymentStatusHistoryEntry {
  id: string;
  from: PaymentStatus | null;
  to: PaymentStatus;
  reason: string | null;
  actorKind: 'staff' | 'system' | 'guest';
  actorUserId: string | null;
  actorName: string;
  occurredAt: Date;
}

export interface PaymentListRow {
  payment: Payment;
  invoiceNo: number;
  description: string;
  customer: { phone: string | null; name: string | null; email: string | null };
  failureReason: string | null;
  cancelReason: string | null;
  amountMismatchAt: Date | null;
}

@Injectable()
export class PaymentRepository {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  private db() {
    return this.database.db<PaymentsTables>();
  }

  /** Записать накопленные переходы статуса платежа (в транзакции сохранения платежа). */
  private async writeStatusHistory(payment: Payment): Promise<void> {
    const changes = payment.pullStatusChanges();
    if (changes.length === 0) return;
    const actor = RequestContext.actor();
    const now = this.clock.now();
    await this.db()
      .insertInto('payments.payment_status_history')
      .values(
        changes.map((c, i) => ({
          id: newId(),
          payment_id: payment.id,
          from_status: c.from,
          to_status: c.to,
          reason: c.reason,
          actor_kind: actor?.kind ?? 'system',
          actor_user_id: actor?.userId ?? null,
          actor_name: actor?.name ?? 'payments',
          // Несколько переходов одного сохранения — в порядке выполнения.
          occurred_at: new Date(now.getTime() + i),
        })),
      )
      .execute();
  }

  async statusHistory(paymentId: string): Promise<PaymentStatusHistoryEntry[]> {
    const rows = await this.db()
      .selectFrom('payments.payment_status_history')
      .selectAll()
      .where('payment_id', '=', paymentId)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      from: r.from_status as PaymentStatus | null,
      to: r.to_status as PaymentStatus,
      reason: r.reason,
      actorKind: r.actor_kind as PaymentStatusHistoryEntry['actorKind'],
      actorUserId: r.actor_user_id,
      actorName: r.actor_name,
      occurredAt: r.occurred_at,
    }));
  }

  async findById(id: string, options: { forUpdate?: boolean } = {}): Promise<Payment | null> {
    let q = this.db().selectFrom('payments.payments').selectAll().where('id', '=', id).where('deleted_at', 'is', null);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? mapPayment(row) : null;
  }

  async findRow(id: string): Promise<Selectable<PaymentsTable> | null> {
    return (await this.db().selectFrom('payments.payments').selectAll().where('id', '=', id).executeTakeFirst()) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<Payment | null> {
    const row = await this.db().selectFrom('payments.payments').selectAll().where('idempotency_key', '=', key).executeTakeFirst();
    return row ? mapPayment(row) : null;
  }

  async findByExternalId(provider: string, externalId: string, options: { forUpdate?: boolean } = {}): Promise<Payment | null> {
    let q = this.db()
      .selectFrom('payments.payments')
      .selectAll()
      .where('provider', '=', provider)
      .where('external_id', '=', externalId);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? mapPayment(row) : null;
  }

  async listForReference(purpose: PaymentPurpose, referenceId: string): Promise<Payment[]> {
    const rows = await this.db()
      .selectFrom('payments.payments')
      .selectAll()
      .where('purpose', '=', purpose)
      .where('reference_id', '=', referenceId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(mapPayment);
  }

  /**
   * Вставка с защитой от гонки по ключу идемпотентности: при конфликте ничего не вставляется
   * и возвращается false — вызывающий код читает уже существующий платёж.
   */
  async insert(payment: Payment): Promise<boolean> {
    const s = payment.snapshot();
    const inserted = await this.db()
      .insertInto('payments.payments')
      .values({ id: s.id, ...this.toRow(s), idempotency_key: s.idempotencyKey, created_at: s.createdAt, deleted_at: null })
      .onConflict((oc) => oc.column('idempotency_key').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted) await this.writeStatusHistory(payment);
    else payment.pullStatusChanges();
    return !!inserted;
  }

  async save(payment: Payment): Promise<void> {
    const s = payment.snapshot();
    await this.db().updateTable('payments.payments').set(this.toRow(s)).where('id', '=', s.id).execute();
    await this.writeStatusHistory(payment);
  }

  private toRow(s: Readonly<PaymentProps>) {
    return {
      purpose: s.purpose,
      reference_id: s.referenceId,
      branch_id: s.branchId,
      method: s.method,
      provider: s.provider,
      status: s.status,
      payment_amount: s.amount.amount,
      payment_currency: s.amount.currency,
      refunded_amount: s.refunded.amount,
      refunded_currency: s.refunded.currency,
      external_id: s.externalId,
      payment_url: s.paymentUrl,
      provider_data: JSON.stringify(s.providerData ?? {}),
      description: s.description,
      customer_phone: s.customer.phone,
      customer_name: s.customer.name,
      customer_email: s.customer.email,
      return_url: s.returnUrl,
      certificate_id: s.certificateId,
      document_number: s.documentNumber,
      failure_reason: s.failureReason,
      cancel_reason: s.cancelReason,
      initiate_attempts: s.initiateAttempts,
      expires_at: s.expiresAt,
      paid_at: s.paidAt,
      failed_at: s.failedAt,
      cancelled_at: s.cancelledAt,
    };
  }

  /**
   * Учёт попытки инициирования — отдельной короткой транзакцией (вне транзакции задачи),
   * чтобы счётчик сохранился, даже если попытка упадёт и задача уйдёт на повтор.
   */
  async incrementInitiateAttempts(id: string): Promise<number> {
    const row = await this.database
      .rootConnection()
      .updateTable('payments.payments')
      .set({ initiate_attempts: sql`initiate_attempts + 1` })
      .where('id', '=', id)
      .returning('initiate_attempts')
      .executeTakeFirst();
    return Number(row?.initiate_attempts ?? 0);
  }

  async markAmountMismatch(id: string, now: Date): Promise<void> {
    await this.db().updateTable('payments.payments').set({ amount_mismatch_at: now }).where('id', '=', id).execute();
  }

  /** Ожидающие онлайн-платежи, которые пора опросить у провайдера (пропущенный вебхук). */
  async claimForPolling(input: { now: Date; createdBefore: Date; checkedBefore: Date; limit: number }): Promise<Array<{ id: string; branchId: string | null }>> {
    return this.database.transaction(async () => {
      const rows = await this.db()
        .selectFrom('payments.payments')
        .select(['id', 'branch_id'])
        .where('status', '=', 'pending')
        .where('method', '=', 'online')
        .where('external_id', 'is not', null)
        .where('created_at', '<=', input.createdBefore)
        .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', input.now)]))
        .where((eb) => eb.or([eb('last_checked_at', 'is', null), eb('last_checked_at', '<=', input.checkedBefore)]))
        .orderBy('created_at')
        .limit(input.limit)
        .forUpdate()
        .skipLocked()
        .execute();
      if (rows.length > 0) {
        await this.db()
          .updateTable('payments.payments')
          .set({ last_checked_at: input.now })
          .where(
            'id',
            'in',
            rows.map((r) => r.id),
          )
          .execute();
      }
      return rows.map((r) => ({ id: r.id, branchId: r.branch_id }));
    });
  }

  /** Неоплаченные платежи с истёкшим сроком, которые ещё не взяты на финальную проверку. */
  async claimExpired(input: { now: Date; limit: number }): Promise<Array<{ id: string; status: PaymentStatus; branchId: string | null }>> {
    return this.database.transaction(async () => {
      const rows = await this.db()
        .selectFrom('payments.payments')
        .select(['id', 'status', 'branch_id'])
        .where('status', 'in', ['created', 'pending'])
        .where('method', '=', 'online')
        .where('expires_at', '<=', input.now)
        .where('expiry_check_at', 'is', null)
        .orderBy('expires_at')
        .limit(input.limit)
        .forUpdate()
        .skipLocked()
        .execute();
      if (rows.length > 0) {
        await this.db()
          .updateTable('payments.payments')
          .set({ expiry_check_at: input.now })
          .where(
            'id',
            'in',
            rows.map((r) => r.id),
          )
          .execute();
      }
      return rows.map((r) => ({ id: r.id, status: r.status as PaymentStatus, branchId: r.branch_id }));
    });
  }

  async search(filter: PaymentSearchFilter, page: PageRequest): Promise<Page<PaymentListRow>> {
    let q = this.db().selectFrom('payments.payments').where('deleted_at', 'is', null);
    if (filter.branches !== 'all') {
      if (filter.branches.length === 0) return pageOf([], 0, page);
      q = q.where('branch_id', 'in', filter.branches);
    }
    if (filter.purpose) q = q.where('purpose', '=', filter.purpose);
    if (filter.method) q = q.where('method', '=', filter.method);
    if (filter.provider) q = q.where('provider', '=', filter.provider);
    if (filter.status) q = q.where('status', '=', filter.status);
    if (filter.referenceId) q = q.where('reference_id', '=', filter.referenceId);
    if (filter.from) q = q.where('created_at', '>=', filter.from);
    if (filter.to) q = q.where('created_at', '<', filter.to);
    if (filter.phoneDigits) q = q.where('customer_phone', 'like', `%${filter.phoneDigits}%`);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(page.perPage)
      .offset(offsetOf(page))
      .execute();
    return pageOf(rows.map((r) => this.listRow(r)), Number(total?.n ?? 0), page);
  }

  listRow(r: Selectable<PaymentsTable>): PaymentListRow {
    return {
      payment: mapPayment(r),
      invoiceNo: Number(r.invoice_no),
      description: r.description,
      customer: { phone: r.customer_phone, name: r.customer_name, email: r.customer_email },
      failureReason: r.failure_reason,
      cancelReason: r.cancel_reason,
      amountMismatchAt: r.amount_mismatch_at,
    };
  }
}
