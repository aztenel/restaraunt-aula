import { describe, expect, it } from 'vitest';
import { certificateOrderPhase, formatCertificateCode, isCompleteCertificateCode, isSafePaymentUrl } from '@/lib/certificates';
import { paymentReturnPath } from '@/lib/payment-return';

const TOKEN = 'Abc_def-1234567890XYZ';

describe('возврат с оплаты', () => {
  it('выбирает страницу статуса по типу покупки', () => {
    expect(paymentReturnPath('order', TOKEN)).toBe(`/orders/${TOKEN}`);
    expect(paymentReturnPath('gift_certificate', TOKEN)).toBe(`/certificates/order/${TOKEN}`);
    expect(paymentReturnPath('certificate', TOKEN)).toBe(`/certificates/order/${TOKEN}`);
    expect(paymentReturnPath('reservation_deposit', TOKEN)).toBe(`/booking/${TOKEN}`);
    expect(paymentReturnPath('BOOKING', TOKEN)).toBe(`/booking/${TOKEN}`);
    expect(paymentReturnPath('banquet_invoice', TOKEN)).toBe(`/banquets/invoice/${TOKEN}`);
  });

  it('неизвестный тип или подозрительный токен — без перехода', () => {
    expect(paymentReturnPath('unknown', TOKEN)).toBeNull();
    expect(paymentReturnPath('order', '../../admin')).toBeNull();
    expect(paymentReturnPath('order', 'https://evil.com/x')).toBeNull();
    expect(paymentReturnPath(undefined, TOKEN)).toBeNull();
    expect(paymentReturnPath('order', 'short')).toBeNull();
  });
});

describe('статус покупки сертификата', () => {
  const payment = (status: string, paymentUrl: string | null = null) => ({ status, paymentUrl });
  it('экран по статусам сервера', () => {
    expect(certificateOrderPhase({ status: 'awaiting_payment', payment: payment('created') })).toBe('preparing');
    expect(certificateOrderPhase({ status: 'awaiting_payment', payment: null })).toBe('preparing');
    expect(certificateOrderPhase({ status: 'awaiting_payment', payment: payment('pending', 'https://pay.kz/x') })).toBe('awaiting');
    expect(certificateOrderPhase({ status: 'issued', payment: payment('succeeded', 'https://pay.kz/x') })).toBe('issued');
    expect(certificateOrderPhase({ status: 'payment_failed', payment: payment('failed') })).toBe('failed');
    expect(certificateOrderPhase({ status: 'awaiting_payment', payment: payment('cancelled') })).toBe('cancelled');
  });

  it('переход на оплату — только http(s)', () => {
    expect(isSafePaymentUrl('https://epay.kz/pay?id=1')).toBe(true);
    expect(isSafePaymentUrl('/api/v1/public/payments/1/checkout?sig=x')).toBe(true);
    expect(isSafePaymentUrl('javascript:alert(1)')).toBe(false);
    expect(isSafePaymentUrl(null)).toBe(false);
  });

  it('ввод кода сертификата', () => {
    expect(formatCertificateCode('abcd efgh-jkmn')).toBe('ABCD-EFGH-JKMN');
    expect(formatCertificateCode('ab')).toBe('AB');
    expect(formatCertificateCode('abcde')).toBe('ABCD-E');
    expect(formatCertificateCode('ABCDEFGHJKMNPQ')).toBe('ABCD-EFGH-JKMN');
    expect(isCompleteCertificateCode('ABCD-EFGH-JKMN')).toBe(true);
    expect(isCompleteCertificateCode('ABCD-EFGH')).toBe(false);
  });
});
