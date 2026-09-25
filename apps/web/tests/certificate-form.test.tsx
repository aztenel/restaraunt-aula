import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '@/messages/ru.json';
import { CertificatePurchaseForm } from '@/components/certificates/CertificatePurchaseForm';
import { emptyCertificateForm, toPurchaseBody, validateCertificateForm } from '@/lib/certificates';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('@/lib/api', () => ({ getBrowserApi: () => api }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/certificates',
  useRouter: () => router,
}));

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const kzt = (amount: number) => ({ amount, currency: 'KZT' as const });
const products = [
  {
    id: PRODUCT_ID,
    slug: 'nominal-10000',
    kind: 'amount' as const,
    name: 'Сертификат на 10 000 ₸',
    description: '',
    nominal: kzt(1000000),
    price: kzt(1000000),
    validityMonths: 12,
    design: { color: '#7a4b2a', theme: 'classic', imageUrl: null },
  },
];

function filled() {
  return {
    ...emptyCertificateForm(PRODUCT_ID),
    buyerName: 'Айгерим',
    buyerPhone: '+7 777 123 45 67',
    buyerEmail: 'aigerim@mail.kz',
    recipientName: 'Данияр',
  };
}

describe('проверка формы покупки сертификата', () => {
  it('согласие на обработку ПД обязательно', () => {
    expect(validateCertificateForm(filled())).toEqual({ consentPersonalData: 'consent' });
    expect(validateCertificateForm({ ...filled(), consentPersonalData: true })).toEqual({});
  });

  it('обязательные поля, формат почты и телефона, лимиты', () => {
    const errors = validateCertificateForm({
      ...emptyCertificateForm(''),
      buyerName: 'А',
      buyerPhone: '123',
      buyerEmail: 'не почта',
      recipientEmail: 'x@',
      message: 'x'.repeat(501),
      quantity: 11,
    });
    expect(errors).toEqual({
      productId: 'product',
      quantity: 'quantity',
      buyerName: 'tooShort',
      buyerPhone: 'phone',
      buyerEmail: 'email',
      recipientName: 'required',
      recipientEmail: 'email',
      message: 'tooLong',
      consentPersonalData: 'consent',
    });
  });

  it('тело запроса: без пустых необязательных полей, с языком и ключом идемпотентности', () => {
    const body = toPurchaseBody({ ...filled(), consentPersonalData: true, recipientPhone: ' ', message: '' }, { locale: 'kk', idempotencyKey: 'key-12345678' });
    expect(body).toEqual({
      productId: PRODUCT_ID,
      quantity: 1,
      buyer: { name: 'Айгерим', phone: '+7 777 123 45 67', email: 'aigerim@mail.kz' },
      recipient: { name: 'Данияр' },
      deliveryChannel: 'email',
      consent: { personalData: true },
      locale: 'kk',
      idempotencyKey: 'key-12345678',
    });
  });
});

describe('форма покупки сертификата', () => {
  beforeEach(() => {
    api.POST.mockReset();
    router.push.mockReset();
  });
  afterEach(cleanup);

  function renderForm() {
    render(
      <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
        <CertificatePurchaseForm products={products} consent={{ version: '2026-09-25', text: 'Я даю согласие…', publishedAt: '2026-09-25T00:00:00.000Z' }} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(ru.CertificateForm.buyerName), { target: { value: 'Айгерим' } });
    fireEvent.change(screen.getByLabelText(ru.CertificateForm.buyerPhone), { target: { value: '+7 777 123 45 67' } });
    fireEvent.change(screen.getByLabelText(ru.CertificateForm.buyerEmail), { target: { value: 'aigerim@mail.kz' } });
    fireEvent.change(screen.getByLabelText(ru.CertificateForm.recipientName), { target: { value: 'Данияр' } });
  }

  it('без согласия не отправляет запрос и показывает ошибку у флажка', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: ru.CertificateForm.submit }));
    expect(await screen.findByText(ru.CertificateForm.errors.consent)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(ru.CertificateForm.errorSummary);
    const consent = screen.getByLabelText(ru.CertificateForm.consent);
    expect(consent.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(consent);
    expect(api.POST).not.toHaveBeenCalled();
  });

  it('с согласием отправляет покупку с ключом идемпотентности и ведёт на страницу заказа', async () => {
    api.POST.mockResolvedValue({
      data: {
        orderToken: 'TokenABCDEFGH123',
        orderId: 'o1',
        status: 'awaiting_payment',
        total: kzt(1000000),
        payment: { id: 'p1', status: 'created', paymentUrl: null, amount: kzt(1000000), expiresAt: null },
      },
      response: new Response(null, { status: 201 }),
    });
    renderForm();
    fireEvent.click(screen.getByLabelText(ru.CertificateForm.consent));
    fireEvent.click(screen.getByRole('button', { name: ru.CertificateForm.submit }));

    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(api.POST).toHaveBeenCalledTimes(1);
    const [path, init] = api.POST.mock.calls[0]!;
    expect(path).toBe('/api/v1/public/certificates/purchase');
    expect(init.body).toMatchObject({
      productId: PRODUCT_ID,
      quantity: 1,
      consent: { personalData: true },
      locale: 'ru',
      recipient: { name: 'Данияр' },
    });
    expect(init.body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/certificates/order/TokenABCDEFGH123', query: { pay: '1' } });
  });
});
