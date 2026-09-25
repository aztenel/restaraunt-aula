import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { StateMachine } from '../../../shared/kernel/state-machine';
import { addDays } from '../../../shared/kernel/time';

/**
 * Счёт по банкету. Физлицу — ссылка на онлайн-оплату, юрлицу — счёт на оплату с реквизитами (PDF),
 * поступления регистрирует финансист. Инвариант ТЗ: сумма оплат не превышает сумму счёта.
 */
export const InvoiceStatus = {
  Issued: 'issued',
  PartiallyPaid: 'partially_paid',
  Paid: 'paid',
  Cancelled: 'cancelled',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const INVOICE_FSM = new StateMachine<InvoiceStatus>('banquet_invoice', {
  issued: ['partially_paid', 'paid', 'cancelled'],
  partially_paid: ['paid'],
  paid: [],
  cancelled: [],
});

export const PAYER_TYPES = ['individual', 'company'] as const;
export type PayerType = (typeof PAYER_TYPES)[number];

export const INVOICE_PURPOSES = ['prepayment', 'payment'] as const;
export type InvoicePurpose = (typeof INVOICE_PURPOSES)[number];

/** Срок оплаты по умолчанию: физлицу — 3 дня, юрлицу — 5 дней, но не позже даты мероприятия. */
export const DEFAULT_DUE_DAYS: Record<PayerType, number> = { individual: 3, company: 5 };

export function defaultDueDate(today: string, eventDate: string, payerType: PayerType): string {
  const due = addDays(today, DEFAULT_DUE_DAYS[payerType]);
  const latest = eventDate > today ? eventDate : today;
  return due < latest ? due : latest;
}

export interface InvoiceState {
  id: string;
  amount: Money;
  paid: Money;
  refunded: Money;
  status: InvoiceStatus;
  dueDate: string;
  paidAt: Date | null;
  cancelledAt: Date | null;
}

export class BanquetInvoice {
  constructor(private state: InvoiceState) {}

  snapshot(): Readonly<InvoiceState> {
    return this.state;
  }

  get status(): InvoiceStatus {
    return this.state.status;
  }

  remaining(): Money {
    return this.state.amount.subtract(this.state.paid).clampToZero();
  }

  /** Получено за вычетом возвратов. */
  netPaid(): Money {
    return this.state.paid.subtract(this.state.refunded);
  }

  isFullyPaid(): boolean {
    return this.state.paid.greaterThanOrEqual(this.state.amount);
  }

  /** Срок оплаты прошёл, а счёт оплачен не полностью. */
  isOverdue(today: string): boolean {
    return (this.state.status === 'issued' || this.state.status === 'partially_paid') && this.state.dueDate < today;
  }

  /** Поступление принимается, только если не превышает остаток по счёту. */
  assertCanAccept(amount: Money): void {
    if (!amount.isPositive()) throw new ValidationError('banquet_invoice.invalid_amount', 'Payment amount must be positive');
    if (this.state.status === 'cancelled') {
      throw new ConflictError('banquet_invoice.cancelled', 'Invoice is cancelled');
    }
    if (this.state.paid.add(amount).greaterThan(this.state.amount)) {
      throw new ConflictError('banquet_invoice.overpayment', 'Payments cannot exceed the invoice amount', {
        amount: amount.toJSON(),
        remaining: this.remaining().toJSON(),
      });
    }
  }

  canAccept(amount: Money): boolean {
    try {
      this.assertCanAccept(amount);
      return true;
    } catch {
      return false;
    }
  }

  recordPayment(amount: Money, now: Date): { fullyPaid: boolean } {
    this.assertCanAccept(amount);
    const paid = this.state.paid.add(amount);
    const fullyPaid = paid.greaterThanOrEqual(this.state.amount);
    const next: InvoiceStatus = fullyPaid ? 'paid' : 'partially_paid';
    if (next !== this.state.status) INVOICE_FSM.assertTransition(this.state.status, next);
    this.state = { ...this.state, paid, status: next, paidAt: fullyPaid ? now : this.state.paidAt };
    return { fullyPaid };
  }

  recordRefund(amount: Money): void {
    const refunded = this.state.refunded.add(amount);
    this.state = { ...this.state, refunded: refunded.greaterThan(this.state.paid) ? this.state.paid : refunded };
  }

  /** Отменить можно только счёт без поступлений. */
  cancel(now: Date): void {
    if (this.state.paid.isPositive()) {
      throw new ConflictError('banquet_invoice.has_payments', 'Invoice with payments cannot be cancelled; request a refund instead');
    }
    INVOICE_FSM.assertTransition(this.state.status, 'cancelled');
    this.state = { ...this.state, status: 'cancelled', cancelledAt: now };
  }
}

export interface InvoiceAmountContext {
  /** Статус заявки: пока предоплата не получена, по умолчанию выставляется остаток предоплаты. */
  requestStatus: string;
  quoteTotal: Money;
  requiredPrepayment: Money | null;
  /** Сумма действующих (не отменённых) счетов по заявке. */
  invoicedActive: Money;
}

/** Сумма счёта по умолчанию: остаток предоплаты (до prepaid) или остаток до итога сметы. */
export function defaultInvoiceAmount(ctx: InvoiceAmountContext): { amount: Money; purpose: InvoicePurpose } {
  if (ctx.requestStatus === 'agreed' && ctx.requiredPrepayment && ctx.requiredPrepayment.greaterThan(ctx.invoicedActive)) {
    return { amount: ctx.requiredPrepayment.subtract(ctx.invoicedActive), purpose: 'prepayment' };
  }
  return { amount: ctx.quoteTotal.subtract(ctx.invoicedActive).clampToZero(), purpose: 'payment' };
}

/** Сумма всех действующих счетов не превышает итог сметы. */
export function assertWithinQuote(amount: Money, ctx: Pick<InvoiceAmountContext, 'quoteTotal' | 'invoicedActive'>): void {
  if (!amount.isPositive()) throw new ValidationError('banquet_invoice.nothing_to_invoice', 'Invoice amount must be positive');
  if (ctx.invoicedActive.add(amount).greaterThan(ctx.quoteTotal)) {
    throw new ValidationError('banquet_invoice.exceeds_quote', 'Invoices cannot exceed the quote total', {
      quoteTotal: ctx.quoteTotal.toJSON(),
      invoiced: ctx.invoicedActive.toJSON(),
    });
  }
}
