import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch } from '../../../test/support/fixtures';
import { hmacSha256 } from '../../shared/infrastructure/crypto/secret-box';
import { IntegrationCatalog } from '../../shared/infrastructure/settings/integration-catalog';
import { ROUTING_SETTINGS_KEY } from './application/payment-gateway.registry';
import { HALYK_SETTINGS_KEY, HalykGateway } from './infrastructure/adapters/halyk/halyk.gateway';
import { KASPI_SETTINGS_KEY } from './infrastructure/adapters/kaspi/kaspi.gateway';
import { CreatePaymentCommand, PaymentsEvents, PaymentsService } from './public';
import { apiPath, createPaymentsTestApp, PaymentsTestContext, publishedEvents, resetPayments, setIntegration, tenge } from './testing/payments-test-kit';

describe('Payment provider adapters (integration, no network)', () => {
  let ctx: PaymentsTestContext;
  let payments: PaymentsService;
  let branchId: string;

  beforeAll(async () => {
    ctx = await createPaymentsTestApp();
    payments = ctx.t.get(PaymentsService);
  });
  afterAll(async () => ctx.t.close());
  beforeEach(async () => {
    await resetPayments(ctx);
    branchId = await createBranch(ctx.t);
  });

  function command(overrides: Partial<CreatePaymentCommand> = {}): CreatePaymentCommand {
    return {
      purpose: 'reservation_deposit',
      referenceId: 'reservation-1',
      branchId,
      method: 'online',
      amount: tenge(15_000),
      description: 'Депозит брони R-1',
      customer: { phone: '+77771234567', name: 'Гость', email: 'guest@example.kz' },
      returnUrl: 'https://aula.kz/reservations/r1',
      idempotencyKey: `dep-${Math.random()}`,
      ...overrides,
    };
  }

  it('registers integration descriptors in the catalog', () => {
    const keys = ctx.t.get(IntegrationCatalog).list().map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(['payments.routing', 'payments.sandbox', 'payments.halyk', 'payments.kaspi']));
  });

  describe('Halyk ePay', () => {
    beforeEach(async () => {
      await setIntegration(ctx, ROUTING_SETTINGS_KEY, { defaultProvider: 'halyk' });
      await setIntegration(ctx, HALYK_SETTINGS_KEY, { clientId: 'aula-client', terminalId: 'term-67e34d63', testMode: true }, { clientSecret: 's3cr3t' });
    });

    async function initiated() {
      ctx.http.on('test-epay.homebank.kz/oauth2/token', 200, { access_token: 'invoice-token-1', expires_in: 1200, token_type: 'Bearer' }, { times: 1 });
      const p = await payments.createPayment(command());
      await ctx.t.drain();
      return payments.getPayment(p.id);
    }

    it('gets an invoice token (client_credentials) and serves the widget checkout page', async () => {
      const p = await initiated();
      expect(p.status).toBe('pending');
      expect(p.provider).toBe('halyk');
      expect(p.externalId).toMatch(/^\d{6,15}$/);
      const tokenRequest = ctx.http.requests[0]!;
      expect(tokenRequest.method).toBe('POST');
      const form = new URLSearchParams(tokenRequest.body);
      expect(Object.fromEntries(form)).toMatchObject({
        grant_type: 'client_credentials',
        client_id: 'aula-client',
        client_secret: 's3cr3t',
        invoiceID: p.externalId,
        amount: '15000.00',
        currency: 'KZT',
        terminal: 'term-67e34d63',
        postLink: 'http://localhost:3000/api/v1/webhooks/payments/halyk',
        failurePostLink: 'http://localhost:3000/api/v1/webhooks/payments/halyk',
      });
      expect(form.get('secret_hash')).toBe(ctx.t.get(HalykGateway).secretHash(p.externalId!));
      expect(p.paymentUrl).toContain(`/api/v1/public/payments/${p.id}/checkout?sig=`);

      const page = await ctx.t.http().get(apiPath(p.paymentUrl!));
      expect(page.status).toBe(200);
      expect(page.text).toContain('https://test-epay.homebank.kz/payform/payment-api.js');
      expect(page.text).toContain('halyk.pay(p)');
      expect(page.text).toContain(`"invoiceId":"${p.externalId}"`);
      expect(page.text).toContain('"access_token":"invoice-token-1"');
      // Подпись ссылки обязательна.
      expect((await ctx.t.http().get(`/api/v1/public/payments/${p.id}/checkout?sig=bad`)).status).toBe(404);
    });

    it('postLink with a valid secret_hash marks the payment paid; failure link and forged hash are handled', async () => {
      const p = await initiated();
      const secret = ctx.t.get(HalykGateway).secretHash(p.externalId!);
      const forged = await ctx.t.http().post('/api/v1/webhooks/payments/halyk').send({ invoiceId: p.externalId, code: 'ok', amount: 15000, secret_hash: 'x' });
      expect(forged.status).toBe(403);
      const ok = await ctx.t.http().post('/api/v1/webhooks/payments/halyk').send({
        id: 'tx-100',
        invoiceId: p.externalId,
        code: 'ok',
        reason: 'success',
        amount: 15000,
        currency: 'KZT',
        cardMask: '440043******0000',
        secret_hash: secret,
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ status: 'ok' });
      expect((await payments.getPayment(p.id)).status).toBe('succeeded');
      // Повтор того же уведомления — без изменений.
      await ctx.t.http().post('/api/v1/webhooks/payments/halyk').send({ id: 'tx-100', invoiceId: p.externalId, code: 'ok', amount: 15000, secret_hash: secret });
      expect(await publishedEvents(ctx.t, PaymentsEvents.PaymentSucceeded)).toHaveLength(1);
    });

    it('failurePostLink -> failed', async () => {
      const p = await initiated();
      const secret = ctx.t.get(HalykGateway).secretHash(p.externalId!);
      await ctx.t
        .http()
        .post('/api/v1/webhooks/payments/halyk')
        .send({ id: 'tx-101', invoiceId: p.externalId, code: 'error', reason: 'Insufficient funds', reasonCode: 51, amount: 15000, secret_hash: secret });
      const failed = await payments.getPayment(p.id);
      expect(failed.status).toBe('failed');
      expect((await publishedEvents(ctx.t, PaymentsEvents.PaymentFailed))[0]!.payload.reason).toBe('Insufficient funds');
    });

    it('status check API (missed postLink) and refund API with the transaction id', async () => {
      const p = await initiated();
      ctx.http.on('test-epay.homebank.kz/oauth2/token', 200, { access_token: 'api-token', expires_in: 7200 });
      ctx.http.on('/check-status/payment/transaction/', 200, {
        resultCode: '100',
        resultMessage: 'OK',
        transaction: { id: 'tx-200', invoiceID: p.externalId, amount: 15000, statusName: 'CHARGE', cardMask: '440043******0000' },
      });
      ctx.t.clock.advance(4 * 60_000);
      await ctx.t.runSchedule('payments.poll_pending');
      await ctx.t.drain();
      expect((await payments.getPayment(p.id)).status).toBe('succeeded');
      const statusCall = ctx.http.requests.find((r) => r.url.includes('/check-status/'))!;
      expect(statusCall.url).toBe(`https://test-epay.homebank.kz/api/check-status/payment/transaction/${p.externalId}`);
      expect(statusCall.headers.authorization).toBe('Bearer api-token');

      ctx.http.on('/operation/tx-200/refund', 200, { code: 0, message: 'OK' });
      await payments.requestRefund({ paymentId: p.id, amount: tenge(5000), reason: 'Отмена брони', idempotencyKey: 'h-rf-1' });
      await ctx.t.drain();
      const refundCall = ctx.http.requests.find((r) => r.url.includes('/refund'))!;
      expect(refundCall.url).toBe('https://test-epay.homebank.kz/api/operation/tx-200/refund?amount=5000.00');
      expect((await payments.getPayment(p.id)).status).toBe('partially_refunded');
    });

    it('status check: not found yet stays pending; declined -> failed', async () => {
      const p = await initiated();
      ctx.http.on('test-epay.homebank.kz/oauth2/token', 200, { access_token: 'api-token', expires_in: 7200 });
      ctx.http.on('/check-status/payment/transaction/', 200, { resultCode: '101', resultMessage: 'Not found' }, { times: 1 });
      ctx.t.clock.advance(4 * 60_000);
      await ctx.t.runSchedule('payments.poll_pending');
      await ctx.t.drain();
      expect((await payments.getPayment(p.id)).status).toBe('pending');
      ctx.http.on('/check-status/payment/transaction/', 200, { resultCode: '100', transaction: { id: 'tx-9', statusName: 'REJECT', reason: 'Declined' } });
      ctx.t.clock.advance(6 * 60_000);
      await ctx.t.runSchedule('payments.poll_pending');
      await ctx.t.drain();
      expect((await payments.getPayment(p.id)).status).toBe('failed');
    });
  });

  describe('Kaspi Pay (configurable)', () => {
    const secret = 'kaspi-webhook-secret-123456';

    beforeEach(async () => {
      await setIntegration(ctx, ROUTING_SETTINGS_KEY, { defaultProvider: 'sandbox', branchOverrides: { [branchId]: 'kaspi' } });
      await setIntegration(
        ctx,
        KASPI_SETTINGS_KEY,
        { baseUrl: 'https://merchant.kaspi.test/v2', merchantId: 'M-1', createPath: '/orders', statusPath: '/orders/{externalId}', refundPath: '/orders/{externalId}/refund' },
        { apiKey: 'kaspi-api-key', webhookSecret: secret },
      );
    });

    async function initiated() {
      ctx.http.on(/merchant\.kaspi\.test\/v2\/orders$/, 200, { paymentId: 'kp-1', paymentUrl: 'https://pay.kaspi.kz/pay/kp-1', status: 'CREATED' }, { times: 1 });
      const p = await payments.createPayment(command());
      await ctx.t.drain();
      return payments.getPayment(p.id);
    }

    it('routes by branch override and creates a payment link via configured paths', async () => {
      const p = await initiated();
      expect(p).toMatchObject({ status: 'pending', provider: 'kaspi', externalId: 'kp-1', paymentUrl: 'https://pay.kaspi.kz/pay/kp-1' });
      const call = ctx.http.requests[0]!;
      expect(call.url).toBe('https://merchant.kaspi.test/v2/orders');
      expect(call.headers.authorization).toBe('Bearer kaspi-api-key');
      expect(JSON.parse(call.body!)).toMatchObject({ merchantId: 'M-1', amount: '15000.00', currency: 'KZT', callbackUrl: 'http://localhost:3000/api/v1/webhooks/payments/kaspi' });
      // Другой филиал — провайдер по умолчанию.
      const other = await createBranch(ctx.t);
      expect((await payments.createPayment(command({ branchId: other }))).provider).toBe('sandbox');
    });

    it('verifies webhook HMAC signature and applies status', async () => {
      const p = await initiated();
      const body = { eventId: 'ev-1', paymentId: 'kp-1', status: 'PAID', amount: '15000.00' };
      const raw = JSON.stringify(body);
      const bad = await ctx.t.http().post('/api/v1/webhooks/payments/kaspi').set('content-type', 'application/json').set('x-signature', 'nope').send(raw);
      expect(bad.status).toBe(403);
      const ok = await ctx.t
        .http()
        .post('/api/v1/webhooks/payments/kaspi')
        .set('content-type', 'application/json')
        .set('x-signature', `sha256=${hmacSha256(secret, raw, 'hex')}`)
        .send(raw);
      expect(ok.status).toBe(200);
      expect((await payments.getPayment(p.id)).status).toBe('succeeded');
    });

    it('polls status and refunds through configured endpoints', async () => {
      const p = await initiated();
      ctx.http.on('/orders/kp-1/refund', 200, { refundId: 'kr-1', status: 'COMPLETED' });
      ctx.http.on('/orders/kp-1', 200, { status: 'paid', amount: '15000.00' });
      ctx.t.clock.advance(4 * 60_000);
      await ctx.t.runSchedule('payments.poll_pending');
      await ctx.t.drain();
      expect((await payments.getPayment(p.id)).status).toBe('succeeded');
      await payments.requestRefund({ paymentId: p.id, reason: 'Отмена', idempotencyKey: 'k-rf-1' });
      await ctx.t.drain();
      const refundCall = ctx.http.requests.find((r) => r.url.endsWith('/orders/kp-1/refund'))!;
      expect(JSON.parse(refundCall.body!)).toMatchObject({ amount: '15000.00', merchantId: 'M-1' });
      expect(refundCall.headers['idempotency-key']).toBeTruthy();
      expect((await payments.getPayment(p.id)).status).toBe('refunded');
    });

    it('refund rejected by the provider fails without retries', async () => {
      const p = await initiated();
      const raw = JSON.stringify({ eventId: 'ev-2', paymentId: 'kp-1', status: 'success', amount: '15000.00' });
      await ctx.t
        .http()
        .post('/api/v1/webhooks/payments/kaspi')
        .set('content-type', 'application/json')
        .set('x-signature', hmacSha256(secret, raw, 'base64'))
        .send(raw);
      expect((await payments.getPayment(p.id)).status).toBe('succeeded');
      ctx.http.on('/orders/kp-1/refund', 200, { status: 'DECLINED', message: 'Refund period expired' });
      await payments.requestRefund({ paymentId: p.id, reason: 'Отмена', idempotencyKey: 'k-rf-2' });
      await ctx.t.drain();
      expect(await publishedEvents(ctx.t, PaymentsEvents.RefundFailed)).toHaveLength(1);
      expect(ctx.fakes.notifier.staff.map((s) => s.template)).toContain('staff.refund_failed');
    });
  });
});
