import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import { availableActions, extendIssue, requiredReasonIssue, toResendBody, validateResend } from './certificate-actions';
import { emptyIssueForm, toManualIssueBody, validateIssueForm, type IssueFormValues } from './issue-form';
import { emptyProductForm, toProductInput, validateProductForm, type ProductFormValues } from './product-form';

describe('продукт сертификата', () => {
  const valid: ProductFormValues = {
    ...emptyProductForm(),
    slug: 'Nominal-10000',
    name: { ru: 'Сертификат 10 000 ₸', kk: '10 000 ₸ сертификаты' },
    nominal: 1_000_000,
    price: 1_000_000,
  };

  it('правила как на сервере: slug, название, номинал > 0, цена ≥ 0, срок 1–60, цвет', () => {
    expect(validateProductForm(valid)).toEqual({});
    expect(validateProductForm({ ...valid, slug: 'bad slug' })).toEqual({ slug: 'slug_format' });
    expect(validateProductForm({ ...valid, name: { en: 'Only english' } })).toEqual({ name: 'name_required' });
    expect(validateProductForm({ ...valid, nominal: 0 })).toEqual({ nominal: 'nominal_positive' });
    expect(validateProductForm({ ...valid, price: null })).toEqual({ price: 'price_required' });
    expect(validateProductForm({ ...valid, price: 0 })).toEqual({});
    expect(validateProductForm({ ...valid, validityMonths: 61 })).toEqual({ validityMonths: 'validity_range' });
    expect(validateProductForm({ ...valid, color: 'red' })).toEqual({ color: 'color_format' });
  });

  it('набор требует описания состава', () => {
    expect(validateProductForm({ ...valid, kind: 'set' })).toEqual({ description: 'description_required' });
    expect(validateProductForm({ ...valid, kind: 'set', description: { ru: 'Плов, салат, чай' } })).toEqual({});
  });

  it('форма → тело запроса: slug в нижнем регистре, суммы в тиынах, пустые переводы отброшены', () => {
    const input = toProductInput({ ...valid, description: { ru: '  ', kk: 'Сипаттама' }, imageUrl: ' ' });
    expect(input.slug).toBe('nominal-10000');
    expect(input.nominal).toEqual({ amount: 1_000_000, currency: 'KZT' });
    expect(input.description).toEqual({ kk: 'Сипаттама' });
    expect(input.design).toEqual({ color: '#7a4b2a', theme: 'classic', imageUrl: null });
  });
});

describe('выпуск по счёту (корпоративная продажа)', () => {
  const today = '2026-09-25';
  const valid: IssueFormValues = {
    ...emptyIssueForm('ru'),
    productId: 'p1',
    quantity: 10,
    buyerName: 'Айгерим',
    buyerCompany: 'ТОО «Ромашка»',
    documentNumber: '123',
    paidAt: dayjs('2026-09-24'),
  };

  it('обязательные поля и ограничения', () => {
    expect(validateIssueForm(valid, today)).toEqual({});
    expect(validateIssueForm({ ...valid, productId: undefined, quantity: 101, documentNumber: ' ', paidAt: null }, today)).toEqual({
      productId: 'product_required',
      quantity: 'quantity_range',
      documentNumber: 'document_required',
      paidAt: 'paid_at_required',
    });
    expect(validateIssueForm({ ...valid, paidAt: dayjs('2026-09-26') }, today)).toEqual({ paidAt: 'paid_at_future' });
  });

  it('канал отправки требует контакт получателя', () => {
    expect(validateIssueForm({ ...valid, deliveryChannel: 'email' }, today)).toEqual({ buyerEmail: 'email_required' });
    expect(validateIssueForm({ ...valid, deliveryChannel: 'whatsapp' }, today)).toEqual({ buyerPhone: 'phone_required' });
    expect(validateIssueForm({ ...valid, deliveryChannel: 'email', recipientIsBuyer: false, recipientName: 'Бота' }, today)).toEqual({
      recipientEmail: 'email_required',
    });
  });

  it('тело запроса: итог по договору — только если задан, получатель — если не покупатель', () => {
    const body = toManualIssueBody(valid, 'admin-key');
    expect(body.total).toBeUndefined();
    expect(body.recipient).toBeUndefined();
    expect(body.buyer).toEqual({ name: 'Айгерим', company: 'ТОО «Ромашка»', phone: undefined, email: undefined });
    expect(body.paidAt).toBe('2026-09-23T19:00:00.000Z'); // начало 24.09 по Алматы (UTC+5)
    const withTotal = toManualIssueBody({ ...valid, total: 9_000_000, recipientIsBuyer: false, recipientName: 'Бота' }, 'admin-key');
    expect(withTotal.total).toEqual({ amount: 9_000_000, currency: 'KZT' });
    expect(withTotal.recipient).toEqual({ name: 'Бота', phone: undefined, email: undefined });
  });
});

describe('действия над сертификатом', () => {
  it('блокировка — только с причиной', () => {
    expect(requiredReasonIssue('')).toBe('reason_required');
    expect(requiredReasonIssue('Утерян')).toBeUndefined();
  });

  it('продление: новый последний день позже текущего и не в прошлом', () => {
    expect(extendIssue(null, '2026-12-31', '2026-09-25')).toBe('date_required');
    expect(extendIssue('2026-12-31', '2026-12-31', '2026-09-25')).toBe('date_not_later');
    expect(extendIssue('2026-09-20', '2026-09-01', '2026-09-25')).toBe('date_not_later');
    expect(extendIssue('2027-03-31', '2026-12-31', '2026-09-25')).toBeUndefined();
  });

  it('доступные действия по статусу', () => {
    expect(availableActions('active')).toEqual({ block: true, unblock: false, extend: true });
    expect(availableActions('blocked')).toEqual({ block: false, unblock: true, extend: true });
    expect(availableActions('redeemed')).toEqual({ block: false, unblock: false, extend: false });
  });

  it('переотправка: канал обязателен, если при покупке PDF не отправлялся', () => {
    expect(validateResend({}, 'none')).toEqual({ channel: 'channel_required' });
    expect(validateResend({}, 'email')).toEqual({});
    expect(validateResend({ email: 'bad' }, 'email')).toEqual({ email: 'email_invalid' });
    expect(toResendBody({ channel: 'whatsapp', phone: ' +77011234567 ', email: '' })).toEqual({ channel: 'whatsapp', phone: '+77011234567' });
  });
});
