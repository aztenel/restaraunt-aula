import { describe, expect, it } from 'vitest';
import {
  canRefundPayment,
  invoiceActions,
  newIdempotencyKey,
  overpaymentRemaining,
  toBankTransferInput,
  toIssueInvoiceInput,
  toRefundInput,
  validateBankTransfer,
  validateIssueInvoice,
  validateRefund,
} from './invoice-form';

const tenge = (amount: number) => ({ amount, currency: 'KZT' as const });
const now = Date.parse('2026-10-02T12:00:00.000Z');

describe('выставление счёта', () => {
  const base = { payerType: 'individual' as const, companyId: null, amount: null, dueDate: null, description: '' };

  it('физлицу — всё по умолчанию сервера', () => {
    expect(validateIssueInvoice(base, '2026-10-02')).toEqual([]);
    expect(toIssueInvoiceInput(base)).toEqual({ payerType: 'individual' });
  });

  it('юрлицу нужна компания; сумма и срок — если заданы', () => {
    expect(validateIssueInvoice({ ...base, payerType: 'company' }, '2026-10-02')).toEqual(['companyRequired']);
    const values = { ...base, payerType: 'company' as const, companyId: 'c1', amount: 25_000_050, dueDate: '2026-10-07', description: '  Предоплата 50%  ' };
    expect(validateIssueInvoice(values, '2026-10-02')).toEqual([]);
    expect(toIssueInvoiceInput(values)).toEqual({
      payerType: 'company',
      companyId: 'c1',
      amount: { amount: 25_000_050, currency: 'KZT' },
      dueDate: '2026-10-07',
      description: 'Предоплата 50%',
    });
  });

  it('компания не уходит в счёт физлицу; срок в прошлом и нулевая сумма — ошибки', () => {
    expect(toIssueInvoiceInput({ ...base, companyId: 'c1' })).toEqual({ payerType: 'individual' });
    expect(validateIssueInvoice({ ...base, amount: 0, dueDate: '2026-10-01' }, '2026-10-02')).toEqual(['amountPositive', 'dueDateInPast']);
  });
});

describe('поступление по безналу', () => {
  const remaining = tenge(10_000_000);
  const valid = { amount: 5_000_000, paidAt: '2026-10-02T09:30:00.000Z', documentNumber: ' 1234 ' };

  it('корректное поступление → тело API (тиыны, ISO, номер без пробелов)', () => {
    expect(validateBankTransfer(valid, { remaining, nowMs: now })).toEqual([]);
    expect(toBankTransferInput(valid)).toEqual({ amount: { amount: 5_000_000, currency: 'KZT' }, paidAt: '2026-10-02T09:30:00.000Z', documentNumber: '1234' });
  });

  it('сумма: обязательна, больше нуля, не больше остатка по счёту', () => {
    expect(validateBankTransfer({ ...valid, amount: null }, { remaining, nowMs: now })).toEqual(['amountRequired']);
    expect(validateBankTransfer({ ...valid, amount: 0 }, { remaining, nowMs: now })).toEqual(['amountPositive']);
    expect(validateBankTransfer({ ...valid, amount: 10_000_000 }, { remaining, nowMs: now })).toEqual([]);
    expect(validateBankTransfer({ ...valid, amount: 10_000_001 }, { remaining, nowMs: now })).toEqual(['overpayment']);
  });

  it('дата поступления не в будущем (допуск минута), номер документа 1–60 символов', () => {
    expect(validateBankTransfer({ ...valid, paidAt: '2026-10-02T12:00:59.000Z' }, { remaining, nowMs: now })).toEqual([]);
    expect(validateBankTransfer({ ...valid, paidAt: '2026-10-03T09:00:00.000Z' }, { remaining, nowMs: now })).toEqual(['paidAtInFuture']);
    expect(validateBankTransfer({ ...valid, paidAt: null }, { remaining, nowMs: now })).toEqual(['paidAtRequired']);
    expect(validateBankTransfer({ ...valid, documentNumber: '   ' }, { remaining, nowMs: now })).toEqual(['documentRequired']);
    expect(validateBankTransfer({ ...valid, documentNumber: 'x'.repeat(61) }, { remaining, nowMs: now })).toEqual(['documentTooLong']);
  });

  it('детали ошибки переплаты с сервера', () => {
    expect(overpaymentRemaining({ amount: tenge(1), remaining: tenge(2_500_000) })).toEqual(tenge(2_500_000));
    expect(overpaymentRemaining({})).toBeNull();
  });
});

describe('возврат по платежу', () => {
  const payment = { amount: tenge(5_000_000), refunded: tenge(0) };

  it('полный возврат — без суммы; причина обязательна', () => {
    expect(validateRefund({ amount: null, reason: 'Отмена банкета' }, payment)).toEqual([]);
    expect(toRefundInput({ amount: null, reason: ' Отмена банкета ' }, 'p1', 'key-12345678')).toEqual({
      paymentId: 'p1',
      reason: 'Отмена банкета',
      idempotencyKey: 'key-12345678',
    });
    expect(validateRefund({ amount: null, reason: '  ' }, payment)).toEqual(['reasonRequired']);
  });

  it('частичный — сумма больше нуля и не больше платежа', () => {
    expect(validateRefund({ amount: 1_000_000, reason: 'Меньше гостей' }, payment)).toEqual([]);
    expect(toRefundInput({ amount: 1_000_000, reason: 'Меньше гостей' }, 'p1', 'key-12345678').amount).toEqual({ amount: 1_000_000, currency: 'KZT' });
    expect(validateRefund({ amount: 0, reason: 'x' }, payment)).toEqual(['amountPositive']);
    expect(validateRefund({ amount: 5_000_001, reason: 'x' }, payment)).toEqual(['exceedsPayment']);
  });

  it('ключ идемпотентности — не короче 8 символов и уникальный', () => {
    const a = newIdempotencyKey();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(newIdempotencyKey()).not.toBe(a);
  });
});

describe('кнопки счёта', () => {
  const rights = { invoice: true, refund: true };

  it('поступление — пока счёт ждёт оплаты; отмена — только без оплат', () => {
    expect(invoiceActions({ status: 'issued', paid: tenge(0) }, rights)).toEqual({ registerPayment: true, cancel: true });
    expect(invoiceActions({ status: 'partially_paid', paid: tenge(100) }, rights)).toEqual({ registerPayment: true, cancel: false });
    expect(invoiceActions({ status: 'paid', paid: tenge(100) }, rights)).toEqual({ registerPayment: false, cancel: false });
    expect(invoiceActions({ status: 'cancelled', paid: tenge(0) }, rights)).toEqual({ registerPayment: false, cancel: false });
    expect(invoiceActions({ status: 'issued', paid: tenge(0) }, { invoice: false, refund: true })).toEqual({ registerPayment: false, cancel: false });
  });

  it('возврат — с правом payments.refund, пока платёж возвращён не полностью', () => {
    expect(canRefundPayment({ amount: tenge(100), refunded: tenge(0) }, rights)).toBe(true);
    expect(canRefundPayment({ amount: tenge(100), refunded: tenge(100) }, rights)).toBe(false);
    expect(canRefundPayment({ amount: tenge(100), refunded: tenge(0) }, { invoice: true, refund: false })).toBe(false);
  });
});
