import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch } from '../../../test/support/fixtures';
import { Money } from '../../shared/kernel/money';
import { ROUTING_SETTINGS_KEY } from './application/payment-gateway.registry';
import { HALYK_SETTINGS_KEY } from './infrastructure/adapters/halyk/halyk.gateway';
import { CreatePaymentCommand, PaymentsEvents, PaymentsService } from './public';
import {
  apiPath,
  auditActions,
  createPaymentsTestApp,
  issueCertificate,
  PaymentsTestContext,
  publishedEvents,
  resetPayments,
  sandboxDecision,
  sandboxExternalId,
  SandboxStore,
  sandboxWebhook,
  setIntegration,
  tenge,
} from './testing/payments-test-kit';

describe('Payments (integration)', () => {
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
      purpose: 'order',
      referenceId: 'order-1',
      branchId,
      method: 'online',
      amount: tenge(5000),
      description: 'Заказ GL-2026-000001',
      customer: { phone: '8 777 123 45 67', name: 'Айгерим' },
      returnUrl: 'https://aula.kz/orders/abc',
      idempotencyKey: `order-1:${Math.random()}`,
      ...overrides,
    };
  }

  async function pendingOnline(overrides: Partial<CreatePaymentCommand> = {}) {
    const p = await payments.createPayment(command(overrides));
    await ctx.t.drain();
    return payments.getPayment(p.id);
  }

  async function paidOnline(overrides: Partial<CreatePaymentCommand> = {}) {
    const p = await pendingOnline(overrides);
    const res = await sandboxDecision(ctx, p.paymentUrl!, 'succeeded');
    expect(res.status).toBe(303);
    await ctx.t.drain();
    return payments.getPayment(p.id);
  }

  describe('createPayment', () => {
    it('online: created + async initiation -> pending with payment url; idempotent by key', async () => {
      const cmd = command();
      const p = await payments.createPayment(cmd);
      expect(p.status).toBe('created');
      expect(p.paymentUrl).toBeNull();
      expect(p.provider).toBe('sandbox');
      const again = await payments.createPayment(cmd);
      expect(again.id).toBe(p.id);
      await ctx.t.drain();
      const pending = await payments.getPayment(p.id);
      expect(pending.status).toBe('pending');
      expect(pending.paymentUrl).toMatch(/\/api\/v1\/public\/payments\/sandbox\/.+\?sig=/);
      expect(pending.externalId).toMatch(/^sbx_\d+$/);
      expect(pending.expiresAt).not.toBeNull();
      // Повтор после инициирования возвращает тот же платёж со ссылкой.
      expect((await payments.createPayment(cmd)).paymentUrl).toBe(pending.paymentUrl);
      const rows = await sql<{ n: number }>`select count(*)::int as n from payments.payments`.execute(ctx.t.database.rootConnection());
      expect(rows.rows[0]!.n).toBe(1);
      expect(await auditActions(ctx.t, p.id)).toContain('payment.created');
    });

    it('rejects idempotency key reuse for another reference and bank transfers via createPayment', async () => {
      const cmd = command();
      await payments.createPayment(cmd);
      await expect(payments.createPayment({ ...cmd, referenceId: 'order-2' })).rejects.toMatchObject({ code: 'payment.idempotency_key_reused' });
      await expect(payments.createPayment(command({ method: 'bank_transfer' }))).rejects.toMatchObject({
        code: 'payment.bank_transfer_via_registration',
      });
      await expect(payments.createPayment(command({ amount: Money.zero() }))).rejects.toMatchObject({ code: 'payment.amount_invalid' });
    });

    it('fails fast when the routed provider is not configured', async () => {
      await setIntegration(ctx, ROUTING_SETTINGS_KEY, { defaultProvider: 'kaspi' });
      await expect(payments.createPayment(command())).rejects.toMatchObject({ code: 'payment.provider_unavailable' });
    });

    it('on_receipt: pending without provider; markCollected -> succeeded + PaymentSucceeded; cancel is idempotent', async () => {
      const p = await payments.createPayment(command({ method: 'on_receipt' }));
      expect(p.status).toBe('pending');
      expect(p.provider).toBe('on_receipt');
      await payments.markCollected(p.id);
      await payments.markCollected(p.id);
      expect((await payments.getPayment(p.id)).status).toBe('succeeded');
      const events = await publishedEvents(ctx.t, PaymentsEvents.PaymentSucceeded);
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({ paymentId: p.id, method: 'on_receipt', amount: { amount: 500_000, currency: 'KZT' } });

      const other = await payments.createPayment(command({ method: 'on_receipt', referenceId: 'order-2' }));
      await payments.cancelPayment(other.id, 'order cancelled');
      await payments.cancelPayment(other.id, 'again');
      expect((await payments.getPayment(other.id)).status).toBe('cancelled');
      expect(await publishedEvents(ctx.t, PaymentsEvents.PaymentCancelled)).toHaveLength(1);
      await expect(payments.markCollected(other.id)).rejects.toMatchObject({ code: 'payment.invalid_transition' });
    });

    it('gift_certificate: debits the certificate in the same transaction, succeeded + events', async () => {
      const [cert] = await issueCertificate(ctx, { nominal: 10_000 });
      const p = await payments.createPayment(
        command({ method: 'gift_certificate', certificateCode: cert!.code.toLowerCase(), amount: tenge(4000), idempotencyKey: 'cert-pay-1' }),
      );
      expect(p.status).toBe('succeeded');
      expect(p.provider).toBe('gift_certificate');
      expect(p.paidAt).not.toBeNull();
      const redeemed = await publishedEvents(ctx.t, PaymentsEvents.CertificateRedeemed);
      expect(redeemed.at(-1)!.payload).toMatchObject({
        certificateId: cert!.id,
        amount: { amount: 400_000 },
        balanceAfter: { amount: 600_000 },
        channel: 'order',
        referenceId: 'order-1',
      });
      expect((await publishedEvents(ctx.t, PaymentsEvents.PaymentSucceeded)).some((e) => e.payload.paymentId === p.id)).toBe(true);
      // Повтор с тем же ключом не списывает второй раз.
      await payments.createPayment(
        command({ method: 'gift_certificate', certificateCode: cert!.code, amount: tenge(4000), idempotencyKey: 'cert-pay-1' }),
      );
      const balance = await sql<{ balance_amount: number }>`select balance_amount from payments.gift_certificates where id = ${cert!.id}`.execute(
        ctx.t.database.rootConnection(),
      );
      expect(Number(balance.rows[0]!.balance_amount)).toBe(600_000);
      // Больше остатка — отказ, остаток не уходит в минус.
      await expect(
        payments.createPayment(command({ method: 'gift_certificate', certificateCode: cert!.code, amount: tenge(7000), referenceId: 'order-2' })),
      ).rejects.toMatchObject({ code: 'certificate.insufficient_balance' });
      // Неверный код — not found (и неудача учитывается защитой от подбора).
      await expect(
        payments.createPayment(command({ method: 'gift_certificate', certificateCode: 'AAAA-BBBB-CCCC', referenceId: 'order-3' })),
      ).rejects.toMatchObject({ code: 'certificate.not_found' });
    });

    it('registerBankTransfer: succeeded + event, idempotent', async () => {
      const input = {
        purpose: 'banquet_invoice' as const,
        referenceId: 'invoice-1',
        branchId,
        amount: tenge(250_000),
        paidAt: new Date(ctx.t.clock.now().getTime() - 86_400_000),
        documentNumber: '1234',
        idempotencyKey: 'bank-1',
      };
      const p = await payments.registerBankTransfer(input);
      expect(p).toMatchObject({ status: 'succeeded', method: 'bank_transfer', provider: 'bank_transfer' });
      expect(p.paidAt).toEqual(input.paidAt);
      expect((await payments.registerBankTransfer(input)).id).toBe(p.id);
      await expect(payments.registerBankTransfer({ ...input, referenceId: 'invoice-2' })).rejects.toMatchObject({
        code: 'payment.idempotency_key_reused',
      });
      expect(await publishedEvents(ctx.t, PaymentsEvents.PaymentSucceeded)).toHaveLength(1);
      expect((await payments.listForReference('banquet_invoice', 'invoice-1')).map((x) => x.id)).toEqual([p.id]);
      expect(await auditActions(ctx.t, p.id)).toContain('payment.bank_transfer_registered');
    });
  });

  describe('sandbox provider and webhooks', () => {
    it('serves a payment page; Pay simulates a webhook through the same pipeline', async () => {
      const p = await pendingOnline();
      const page = await ctx.t.http().get(apiPath(p.paymentUrl!));
      expect(page.status).toBe(200);
      expect(page.headers['content-type']).toContain('text/html');
      expect(page.text).toContain('Оплатить');
      expect(page.text).toContain('5\u00a0000');
      // Без подписи — 404.
      expect((await ctx.t.http().get(`/api/v1/public/payments/sandbox/${p.id}`)).status).toBe(404);

      const res = await sandboxDecision(ctx, p.paymentUrl!, 'succeeded');
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('https://aula.kz/orders/abc');
      const paid = await payments.getPayment(p.id);
      expect(paid.status).toBe('succeeded');
      expect(paid.paidAt).not.toBeNull();
      const events = await publishedEvents(ctx.t, PaymentsEvents.PaymentSucceeded);
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({ paymentId: p.id, purpose: 'order', referenceId: 'order-1', branchId, provider: 'sandbox' });
      // Входящий вебхук записан в журнал интеграций.
      const logs = await sql<{ direction: string; operation: string }>`
        select direction, operation from platform.integration_logs where correlation_id = ${p.id}`.execute(ctx.t.database.rootConnection());
      expect(logs.rows.some((l) => l.direction === 'inbound' && l.operation === 'webhook')).toBe(true);
    });

    it('Fail on the page -> failed + PaymentFailed with reason', async () => {
      const p = await pendingOnline();
      await sandboxDecision(ctx, p.paymentUrl!, 'failed');
      expect((await payments.getPayment(p.id)).status).toBe('failed');
      const [failed] = await publishedEvents(ctx.t, PaymentsEvents.PaymentFailed);
      expect(failed!.payload.reason).toContain('Отказ');
    });

    it('webhooks are idempotent by event id; final payments are not changed by repeats', async () => {
      const p = await pendingOnline();
      const body = { eventId: 'evt-1', externalId: p.externalId, status: 'succeeded', amount: { amount: 500_000, currency: 'KZT' } };
      expect((await sandboxWebhook(ctx, body)).status).toBe(200);
      expect((await sandboxWebhook(ctx, body)).status).toBe(200);
      // Другое событие «отказ» по уже оплаченному платежу — без изменений.
      expect((await sandboxWebhook(ctx, { ...body, eventId: 'evt-2', status: 'failed' })).status).toBe(200);
      expect((await payments.getPayment(p.id)).status).toBe('succeeded');
      expect(await publishedEvents(ctx.t, PaymentsEvents.PaymentSucceeded)).toHaveLength(1);
      expect(await publishedEvents(ctx.t, PaymentsEvents.PaymentFailed)).toHaveLength(0);
      const outcomes = await sql<{ event_id: string; outcome: string }>`
        select event_id, outcome from payments.webhook_events order by received_at, event_id`.execute(ctx.t.database.rootConnection());
      expect(outcomes.rows).toEqual([
        { event_id: 'evt-1', outcome: 'applied' },
        { event_id: 'evt-2', outcome: 'ignored' },
      ]);
    });

    it('rejects a webhook with an invalid signature (403) and logs it', async () => {
      const p = await pendingOnline();
      const res = await sandboxWebhook(ctx, { eventId: 'evt-x', externalId: p.externalId, status: 'succeeded' }, 'deadbeef');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('payment.webhook_signature_invalid');
      expect((await payments.getPayment(p.id)).status).toBe('pending');
      expect((await ctx.t.http().post('/api/v1/webhooks/payments/unknown').send({})).status).toBe(404);
    });

    it('amount mismatch: payment is not marked paid, staff is alerted', async () => {
      const p = await pendingOnline();
      await sandboxWebhook(ctx, { eventId: 'evt-m', externalId: p.externalId, status: 'succeeded', amount: { amount: 100, currency: 'KZT' } });
      const after = await payments.getPayment(p.id);
      expect(after.status).toBe('pending');
      expect(ctx.fakes.notifier.staff.map((s) => s.template)).toContain('staff.system_alert');
      expect(await auditActions(ctx.t, p.id)).toContain('payment.amount_mismatch');
      expect(await publishedEvents(ctx.t, PaymentsEvents.PaymentSucceeded)).toHaveLength(0);
    });

    it('late capture: provider confirms after cancellation -> succeeded with previousStatus', async () => {
      const p = await pendingOnline();
      await payments.cancelPayment(p.id, 'order auto-cancelled');
      await sandboxWebhook(ctx, { eventId: 'late', externalId: p.externalId, status: 'succeeded', amount: { amount: 500_000, currency: 'KZT' } });
      expect((await payments.getPayment(p.id)).status).toBe('succeeded');
      const [event] = await publishedEvents(ctx.t, PaymentsEvents.PaymentSucceeded);
      expect(event!.payload.previousStatus).toBe('cancelled');
    });

    it('polls pending payments for a missed webhook', async () => {
      const p = await pendingOnline();
      await ctx.t.get(SandboxStore).setStatus(await sandboxExternalId(ctx, p.id), 'succeeded');
      await ctx.t.runSchedule('payments.poll_pending');
      await ctx.t.drain();
      expect((await payments.getPayment(p.id)).status).toBe('pending'); // слишком свежий для опроса
      ctx.t.clock.advance(4 * 60_000);
      await ctx.t.runSchedule('payments.poll_pending');
      await ctx.t.drain();
      expect((await payments.getPayment(p.id)).status).toBe('succeeded');
      expect(await publishedEvents(ctx.t, PaymentsEvents.PaymentSucceeded)).toHaveLength(1);
    });

    it('expires unpaid payments -> cancelled + PaymentCancelled', async () => {
      const p = await pendingOnline({ expiresAt: new Date(ctx.t.clock.now().getTime() + 10 * 60_000) });
      expect(p.expiresAt!.getTime()).toBe(ctx.t.clock.now().getTime() + 10 * 60_000);
      await ctx.t.runSchedule('payments.expire_pending');
      await ctx.t.drain();
      expect((await payments.getPayment(p.id)).status).toBe('pending');
      ctx.t.clock.advance(11 * 60_000);
      await ctx.t.runSchedule('payments.expire_pending');
      await ctx.t.drain();
      expect((await payments.getPayment(p.id)).status).toBe('cancelled');
      const [cancelled] = await publishedEvents(ctx.t, PaymentsEvents.PaymentCancelled);
      expect(cancelled!.payload).toMatchObject({ paymentId: p.id, reason: 'expired' });
      // Страница оплаты истёкшего платежа больше не принимает оплату.
      const res = await sandboxDecision(ctx, p.paymentUrl!, 'succeeded');
      expect(res.status).toBe(303);
      expect((await payments.getPayment(p.id)).status).toBe('cancelled');
    });

    it('expired payment that the provider reports as paid is confirmed, not cancelled', async () => {
      const p = await pendingOnline({ expiresAt: new Date(ctx.t.clock.now().getTime() + 10 * 60_000) });
      await ctx.t.get(SandboxStore).setStatus(p.externalId!, 'succeeded');
      ctx.t.clock.advance(11 * 60_000);
      await ctx.t.runSchedule('payments.expire_pending');
      await ctx.t.drain();
      expect((await payments.getPayment(p.id)).status).toBe('succeeded');
    });
  });

  describe('initiation retries', () => {
    it('exhausted retries at the provider -> failed + PaymentFailed (no failed job)', async () => {
      await setIntegration(ctx, ROUTING_SETTINGS_KEY, { defaultProvider: 'halyk' });
      await setIntegration(ctx, HALYK_SETTINGS_KEY, { clientId: 'aula', terminalId: 'term-1', testMode: true }, { clientSecret: 'secret' });
      ctx.http.on('oauth2/token', 503, { error: 'unavailable' });
      const p = await payments.createPayment(command());
      for (let i = 0; i < 5; i++) {
        await ctx.t.drain();
        ctx.t.clock.advance(10 * 60_000);
      }
      await ctx.t.drain();
      const failed = await payments.getPayment(p.id);
      expect(failed.status).toBe('failed');
      expect(ctx.http.requests.filter((r) => r.url.includes('oauth2/token'))).toHaveLength(5);
      expect(await publishedEvents(ctx.t, PaymentsEvents.PaymentFailed)).toHaveLength(1);
      const failedJobs = await sql<{ n: number }>`select count(*)::int as n from platform.failed_jobs where topic = 'payments.initiate'`.execute(
        ctx.t.database.rootConnection(),
      );
      expect(failedJobs.rows[0]!.n).toBe(0);
    });

    it('non-retryable provider error fails the payment immediately', async () => {
      await setIntegration(ctx, ROUTING_SETTINGS_KEY, { defaultProvider: 'halyk' });
      await setIntegration(ctx, HALYK_SETTINGS_KEY, { clientId: 'aula', terminalId: 'term-1', testMode: true }, { clientSecret: 'secret' });
      ctx.http.on('oauth2/token', 401, { error: 'invalid_client' });
      const p = await payments.createPayment(command());
      await ctx.t.drain();
      expect((await payments.getPayment(p.id)).status).toBe('failed');
      expect(ctx.http.requests).toHaveLength(1);
    });
  });

  describe('refunds', () => {
    it('partial then remaining refund via the provider; flags in RefundSucceeded; never above amount', async () => {
      const p = await paidOnline();
      const r1 = await payments.requestRefund({ paymentId: p.id, amount: tenge(2000), reason: 'Недовложение', idempotencyKey: 'rf-1' });
      expect(r1.status).toBe('pending');
      expect((await payments.requestRefund({ paymentId: p.id, amount: tenge(2000), reason: 'x', idempotencyKey: 'rf-1' })).id).toBe(r1.id);
      // Ожидающий возврат резервирует сумму: больше остатка запросить нельзя.
      await expect(payments.requestRefund({ paymentId: p.id, amount: tenge(3001), reason: 'x', idempotencyKey: 'rf-2' })).rejects.toMatchObject({
        code: 'payment.refund_exceeds',
      });
      await ctx.t.drain();
      expect((await payments.getPayment(p.id)).status).toBe('partially_refunded');

      const r2 = await payments.requestRefund({ paymentId: p.id, reason: 'Отмена', idempotencyKey: 'rf-3' });
      expect(r2.amount.amount).toBe(300_000);
      await ctx.t.drain();
      const refunded = await payments.getPayment(p.id);
      expect(refunded.status).toBe('refunded');
      expect(refunded.refundedAmount.amount).toBe(500_000);
      await expect(payments.requestRefund({ paymentId: p.id, reason: 'x', idempotencyKey: 'rf-4' })).rejects.toMatchObject({
        code: 'payment.nothing_to_refund',
      });

      const events = await publishedEvents(ctx.t, PaymentsEvents.RefundSucceeded);
      expect(events.map((e) => [e.payload.amount.amount, e.payload.paymentFullyRefunded, e.payload.referenceFullyRefunded])).toEqual([
        [200_000, false, false],
        [300_000, true, true],
      ]);
      expect(await auditActions(ctx.t, p.id)).toEqual(expect.arrayContaining(['refund.requested', 'refund.succeeded']));
    });

    it('referenceFullyRefunded considers all paid payments of the reference', async () => {
      const [cert] = await issueCertificate(ctx, { nominal: 5000 });
      const certPay = await payments.createPayment(
        command({ method: 'gift_certificate', certificateCode: cert!.code, amount: tenge(1000), idempotencyKey: 'split-cert' }),
      );
      const online = await paidOnline({ amount: tenge(4000), idempotencyKey: 'split-online' });
      await payments.requestRefund({ paymentId: online.id, reason: 'Отмена заказа', idempotencyKey: 'split-rf-1' });
      await ctx.t.drain();
      let events = await publishedEvents(ctx.t, PaymentsEvents.RefundSucceeded);
      expect(events.at(-1)!.payload).toMatchObject({ paymentFullyRefunded: true, referenceFullyRefunded: false });
      // Возврат по сертификату — задачей payments.refund, обратно на сертификат.
      const certRefund = await payments.requestRefund({ paymentId: certPay.id, reason: 'Отмена заказа', idempotencyKey: 'split-rf-2' });
      expect(certRefund.status).toBe('pending');
      await ctx.t.drain();
      events = await publishedEvents(ctx.t, PaymentsEvents.RefundSucceeded);
      expect(events.at(-1)!.payload).toMatchObject({ paymentFullyRefunded: true, referenceFullyRefunded: true });
      const balance = await sql<{ balance_amount: number; status: string }>`
        select balance_amount, status from payments.gift_certificates where id = ${cert!.id}`.execute(ctx.t.database.rootConnection());
      expect(Number(balance.rows[0]!.balance_amount)).toBe(500_000);
      const ledger = await sql<{ kind: string }>`
        select kind from payments.certificate_transactions where certificate_id = ${cert!.id} order by occurred_at, kind`.execute(
        ctx.t.database.rootConnection(),
      );
      expect(ledger.rows.map((r) => r.kind).sort()).toEqual(['credit', 'debit', 'issue']);
    });

    it('on_receipt refund stays pending for manual confirmation by finance', async () => {
      const p = await payments.createPayment(command({ method: 'on_receipt' }));
      await expect(payments.requestRefund({ paymentId: p.id, reason: 'x', idempotencyKey: 'or-0' })).rejects.toMatchObject({
        code: 'payment.not_refundable',
      });
      await payments.markCollected(p.id);
      const r = await payments.requestRefund({ paymentId: p.id, amount: tenge(1500), reason: 'Не довезли напиток', idempotencyKey: 'or-1' });
      await ctx.t.drain();
      const rows = await sql<{ status: string; mode: string }>`select status, mode from payments.refunds where id = ${r.id}`.execute(
        ctx.t.database.rootConnection(),
      );
      expect(rows.rows[0]).toEqual({ status: 'pending', mode: 'manual' });
      expect((await payments.getPayment(p.id)).status).toBe('succeeded');
    });

    it('final provider failure -> RefundFailed + staff notification', async () => {
      await setIntegration(ctx, ROUTING_SETTINGS_KEY, { defaultProvider: 'halyk' });
      await setIntegration(ctx, HALYK_SETTINGS_KEY, { clientId: 'aula', terminalId: 'term-1', testMode: true }, { clientSecret: 'secret' });
      ctx.http.on('oauth2/token', 200, { access_token: 'tok', expires_in: 1200 });
      const p = await payments.createPayment(command());
      await ctx.t.drain();
      const pending = await payments.getPayment(p.id);
      const { HalykGateway } = await import('./infrastructure/adapters/halyk/halyk.gateway');
      const secret = ctx.t.get(HalykGateway).secretHash(pending.externalId!);
      const hook = await ctx.t
        .http()
        .post('/api/v1/webhooks/payments/halyk')
        .send({ invoiceId: pending.externalId, code: 'ok', amount: 5000, id: 'tx-77', secret_hash: secret });
      expect(hook.status).toBe(200);
      ctx.http.on('/operation/tx-77/refund', 503, { message: 'down' });
      const r = await payments.requestRefund({ paymentId: p.id, reason: 'Отмена', idempotencyKey: 'hf-1' });
      for (let i = 0; i < 6; i++) {
        await ctx.t.drain();
        ctx.t.clock.advance(60 * 60_000);
      }
      await ctx.t.drain();
      const rows = await sql<{ status: string; attempts: number }>`select status, attempts from payments.refunds where id = ${r.id}`.execute(
        ctx.t.database.rootConnection(),
      );
      expect(rows.rows[0]).toEqual({ status: 'failed', attempts: 6 });
      expect(await publishedEvents(ctx.t, PaymentsEvents.RefundFailed)).toHaveLength(1);
      expect(ctx.fakes.notifier.staff.map((s) => s.template)).toContain('staff.refund_failed');
      // Сумма освобождена: можно запросить новый возврат.
      const again = await payments.requestRefund({ paymentId: p.id, reason: 'Повтор', idempotencyKey: 'hf-2' });
      expect(again.amount.amount).toBe(500_000);
    });
  });

  it('does not refund twice at the provider when local completion is retried', async () => {
    const p = await paidOnline();
    const { SandboxGateway } = await import('./infrastructure/adapters/sandbox/sandbox.gateway');
    const gateway = ctx.t.get(SandboxGateway);
    const original = gateway.refund.bind(gateway);
    let calls = 0;
    gateway.refund = async (...args) => {
      calls++;
      return original(...args);
    };
    const { CompleteRefund } = await import('./application/refund.actions');
    const complete = ctx.t.get(CompleteRefund);
    const realComplete = complete.execute.bind(complete);
    let failOnce = true;
    complete.execute = async (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('database is temporarily unavailable');
      }
      return realComplete(...args);
    };
    try {
      await payments.requestRefund({ paymentId: p.id, reason: 'Отмена', idempotencyKey: 'twice-1' });
      await ctx.t.drain();
      ctx.t.clock.advance(10 * 60_000);
      await ctx.t.drain();
    } finally {
      gateway.refund = original;
      complete.execute = realComplete;
    }
    expect(calls).toBe(1);
    expect((await payments.getPayment(p.id)).status).toBe('refunded');
  });

  describe('database invariants', () => {
    it('forbids physical delete and refunded above amount', async () => {
      const p = await payments.createPayment(command({ method: 'on_receipt' }));
      const db = ctx.t.database.rootConnection();
      await expect(sql`delete from payments.payments where id = ${p.id}`.execute(db)).rejects.toThrow(/forbidden/);
      await expect(sql`update payments.payments set refunded_amount = payment_amount + 1 where id = ${p.id}`.execute(db)).rejects.toThrow(
        /payments_refunded_le_amount/,
      );
    });
  });
});
