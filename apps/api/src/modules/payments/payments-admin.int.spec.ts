import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch, tokenFor } from '../../../test/support/fixtures';
import { ROUTING_SETTINGS_KEY } from './application/payment-gateway.registry';
import { HALYK_SETTINGS_KEY } from './infrastructure/adapters/halyk/halyk.gateway';
import { CreatePaymentCommand, PaymentsEvents, PaymentsService } from './public';
import {
  auditEntries,
  createPaymentsTestApp,
  PaymentsTestContext,
  publishedEvents,
  resetPayments,
  sandboxDecision,
  setIntegration,
  tenge,
} from './testing/payments-test-kit';

describe('Payments admin API (integration)', () => {
  let ctx: PaymentsTestContext;
  let payments: PaymentsService;
  let branchA: string;
  let branchB: string;

  beforeAll(async () => {
    ctx = await createPaymentsTestApp();
    payments = ctx.t.get(PaymentsService);
  });
  afterAll(async () => ctx.t.close());
  beforeEach(async () => {
    await resetPayments(ctx);
    branchA = await createBranch(ctx.t);
    branchB = await createBranch(ctx.t);
  });

  function command(overrides: Partial<CreatePaymentCommand> = {}): CreatePaymentCommand {
    return {
      purpose: 'order',
      referenceId: `order-${Math.random()}`,
      branchId: branchA,
      method: 'on_receipt',
      amount: tenge(5000),
      description: 'Заказ',
      customer: { phone: '+77771234567' },
      returnUrl: null,
      idempotencyKey: `k-${Math.random()}`,
      ...overrides,
    };
  }

  async function paidOnline(branchId: string) {
    const p = await payments.createPayment(command({ method: 'online', branchId }));
    await ctx.t.drain();
    await sandboxDecision(ctx, (await payments.getPayment(p.id)).paymentUrl!, 'succeeded');
    await ctx.t.drain();
    return payments.getPayment(p.id);
  }

  it('is closed: 401 without token, 403 without payments.view', async () => {
    expect((await ctx.t.http().get('/api/v1/admin/payments')).status).toBe(401);
    const { auth } = await tokenFor(ctx.t, [{ role: 'content_manager' }]);
    const res = await ctx.t.http().get('/api/v1/admin/payments').set('authorization', auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('access.forbidden');
  });

  it('lists payments with filters, scoped to branches of the actor', async () => {
    const a1 = await payments.createPayment(command({ referenceId: 'ref-a1' }));
    await payments.createPayment(command({ purpose: 'reservation_deposit', referenceId: 'ref-a2' }));
    const b1 = await payments.createPayment(command({ branchId: branchB, referenceId: 'ref-b1' }));
    await payments.registerBankTransfer({
      purpose: 'gift_certificate',
      referenceId: 'corp-1',
      branchId: null,
      amount: tenge(100_000),
      paidAt: ctx.t.clock.now(),
      documentNumber: '77',
      idempotencyKey: 'bank-corp-1',
    });

    const manager = await tokenFor(ctx.t, [{ role: 'branch_manager', branchId: branchA }]);
    const own = await ctx.t.http().get('/api/v1/admin/payments').set('authorization', manager.auth);
    expect(own.status).toBe(200);
    expect(own.body.total).toBe(2);
    expect(own.body.items.every((p: any) => p.branchId === branchA)).toBe(true);
    expect(own.body.items[0]).toMatchObject({ method: 'on_receipt', status: 'pending', amount: { amount: 500_000, currency: 'KZT' } });
    const foreign = await ctx.t.http().get(`/api/v1/admin/payments?branchId=${branchB}`).set('authorization', manager.auth);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('access.forbidden_branch');
    expect((await ctx.t.http().get(`/api/v1/admin/payments/${b1.id}`).set('authorization', manager.auth)).status).toBe(403);

    const finance = await tokenFor(ctx.t, [{ role: 'finance' }]);
    const all = await ctx.t.http().get('/api/v1/admin/payments?perPage=2&page=1').set('authorization', finance.auth);
    expect(all.body).toMatchObject({ total: 4, page: 1, perPage: 2 });
    expect(all.body.items).toHaveLength(2);
    const filtered = await ctx.t
      .http()
      .get('/api/v1/admin/payments?purpose=reservation_deposit&status=pending&method=on_receipt')
      .set('authorization', finance.auth);
    expect(filtered.body.items.map((p: any) => p.referenceId)).toEqual(['ref-a2']);
    const byRef = await ctx.t.http().get('/api/v1/admin/payments?referenceId=ref-a1').set('authorization', finance.auth);
    expect(byRef.body.items.map((p: any) => p.id)).toEqual([a1.id]);
    const byProvider = await ctx.t.http().get('/api/v1/admin/payments?provider=bank_transfer').set('authorization', finance.auth);
    expect(byProvider.body.items).toHaveLength(1);
    expect(byProvider.body.items[0].branchId).toBeNull();
    const future = new Date(ctx.t.clock.now().getTime() + 3600_000).toISOString();
    const byDate = await ctx.t.http().get(`/api/v1/admin/payments?from=${encodeURIComponent(future)}`).set('authorization', finance.auth);
    expect(byDate.body.total).toBe(0);
    expect((await ctx.t.http().get('/api/v1/admin/payments?status=bogus').set('authorization', finance.auth)).status).toBe(400);
  });

  it('shows details with refunds, webhook events and masked provider log', async () => {
    await setIntegration(ctx, ROUTING_SETTINGS_KEY, { defaultProvider: 'halyk' });
    await setIntegration(ctx, HALYK_SETTINGS_KEY, { clientId: 'aula', terminalId: 'term-1', testMode: true }, { clientSecret: 'very-secret-value' });
    ctx.http.on('oauth2/token', 200, { access_token: 'token-abcdef1234', expires_in: 1200, token_type: 'Bearer' });
    const p = await payments.createPayment(command({ method: 'online' }));
    await ctx.t.drain();
    const finance = await tokenFor(ctx.t, [{ role: 'finance' }]);
    const res = await ctx.t.http().get(`/api/v1/admin/payments/${p.id}`).set('authorization', finance.auth);
    expect(res.status).toBe(200);
    expect(res.body.payment).toMatchObject({ id: p.id, status: 'pending', provider: 'halyk', canRefund: false, canCollect: false });
    const tokenLog = res.body.providerLog.find((l: any) => l.operation === 'payment_token');
    expect(tokenLog).toBeTruthy();
    expect(tokenLog.response.body.access_token).toBe('***1234');
    expect(JSON.stringify(res.body.providerLog)).not.toContain('token-abcdef1234');
    expect(JSON.stringify(res.body.providerLog)).not.toContain('very-secret-value');
    // Провайдер недоступен для просмотра в чужом филиале; несуществующий платёж — 404.
    const managerB = await tokenFor(ctx.t, [{ role: 'branch_manager', branchId: branchB }]);
    expect((await ctx.t.http().get(`/api/v1/admin/payments/${p.id}`).set('authorization', managerB.auth)).status).toBe(403);
    const missing = await ctx.t.http().get('/api/v1/admin/payments/01900000-0000-7000-8000-000000000000').set('authorization', finance.auth);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('payment.not_found');
  });

  it('refund endpoint: payments.refund in the branch, audit with staff actor, invariants', async () => {
    const p = await paidOnline(branchA);
    const manager = await tokenFor(ctx.t, [{ role: 'branch_manager', branchId: branchA }]);
    const denied = await ctx.t
      .http()
      .post(`/api/v1/admin/payments/${p.id}/refunds`)
      .set('authorization', manager.auth)
      .send({ reason: 'Отмена', idempotencyKey: 'admin-rf-1' });
    expect(denied.status).toBe(403);

    const finance = await tokenFor(ctx.t, [{ role: 'finance' }], 'Финансист');
    const bad = await ctx.t.http().post(`/api/v1/admin/payments/${p.id}/refunds`).set('authorization', finance.auth).send({ reason: 'x' });
    expect(bad.status).toBe(400);
    const partial = await ctx.t
      .http()
      .post(`/api/v1/admin/payments/${p.id}/refunds`)
      .set('authorization', finance.auth)
      .send({ amount: { amount: 100_000 }, reason: 'Недовложение', idempotencyKey: 'admin-rf-2' });
    expect(partial.status).toBe(201);
    expect(partial.body).toMatchObject({ paymentId: p.id, status: 'pending', amount: { amount: 100_000, currency: 'KZT' } });
    const exceeds = await ctx.t
      .http()
      .post(`/api/v1/admin/payments/${p.id}/refunds`)
      .set('authorization', finance.auth)
      .send({ amount: { amount: 400_001 }, reason: 'Больше остатка', idempotencyKey: 'admin-rf-3' });
    expect(exceeds.status).toBe(409);
    expect(exceeds.body.error.code).toBe('payment.refund_exceeds');
    await ctx.t.drain();
    const detail = await ctx.t.http().get(`/api/v1/admin/payments/${p.id}`).set('authorization', finance.auth);
    expect(detail.body.payment).toMatchObject({ status: 'partially_refunded', refundableAmount: { amount: 400_000 }, canRefund: true });
    expect(detail.body.refunds[0]).toMatchObject({ status: 'succeeded', mode: 'gateway', awaitingManualConfirmation: false });
    expect(detail.body.webhookEvents).toHaveLength(1);
    const audit = await auditEntries(ctx.t, 'refund.requested');
    expect(audit[0]).toMatchObject({ actor_kind: 'staff', entity_id: p.id });
    expect(audit[0]!.before.status).toBe('succeeded');
  });

  it('manual refunds: queue, confirm by finance (payments.manual), reject', async () => {
    const p = await payments.createPayment(command());
    await payments.markCollected(p.id);
    const r1 = await payments.requestRefund({ paymentId: p.id, amount: tenge(1000), reason: 'Сдача', idempotencyKey: 'm-1' });
    const r2 = await payments.requestRefund({ paymentId: p.id, amount: tenge(500), reason: 'Ошибка', idempotencyKey: 'm-2' });
    const finance = await tokenFor(ctx.t, [{ role: 'finance' }]);
    const queue = await ctx.t.http().get('/api/v1/admin/payments/refunds?status=pending&mode=manual').set('authorization', finance.auth);
    expect(queue.status).toBe(200);
    expect(queue.body.total).toBe(2);
    expect(queue.body.items[0]).toMatchObject({ awaitingManualConfirmation: true, payment: { method: 'on_receipt', branchId: branchA } });

    const manager = await tokenFor(ctx.t, [{ role: 'branch_manager', branchId: branchA }]);
    expect(
      (await ctx.t.http().post(`/api/v1/admin/payments/refunds/${r1.id}/confirm`).set('authorization', manager.auth).send({})).status,
    ).toBe(403);
    const confirmed = await ctx.t
      .http()
      .post(`/api/v1/admin/payments/refunds/${r1.id}/confirm`)
      .set('authorization', finance.auth)
      .send({ comment: 'Выдано наличными на кассе' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('succeeded');
    const again = await ctx.t.http().post(`/api/v1/admin/payments/refunds/${r1.id}/confirm`).set('authorization', finance.auth).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('refund.not_pending');

    const rejected = await ctx.t
      .http()
      .post(`/api/v1/admin/payments/refunds/${r2.id}/reject`)
      .set('authorization', finance.auth)
      .send({ reason: 'Гость отказался' });
    expect(rejected.body.status).toBe('failed');
    expect(ctx.fakes.notifier.staff.map((s) => s.template)).not.toContain('staff.refund_failed');
    const payment = await payments.getPayment(p.id);
    expect(payment).toMatchObject({ status: 'partially_refunded', refundedAmount: { amount: 100_000 } });
    expect((await publishedEvents(ctx.t, PaymentsEvents.RefundSucceeded))[0]!.payload).toMatchObject({ refundId: r1.id });
    expect(await publishedEvents(ctx.t, PaymentsEvents.RefundFailed)).toHaveLength(1);
    expect((await auditEntries(ctx.t, 'refund.succeeded'))[0]!.actor_kind).toBe('staff');
  });

  it('payment detail: status history with timestamps and actors; refunds carry who requested and confirmed', async () => {
    const start = ctx.t.clock.now().getTime();
    const p = await payments.createPayment(command({ method: 'online', customer: { phone: '+77015550011', name: 'Айгерим' } }));
    ctx.t.clock.advance(60_000);
    await ctx.t.drain();
    ctx.t.clock.advance(60_000);
    await sandboxDecision(ctx, (await payments.getPayment(p.id)).paymentUrl!, 'succeeded');
    await ctx.t.drain();
    const finance = await tokenFor(ctx.t, [{ role: 'finance' }], 'Финансист Алия');
    ctx.t.clock.advance(60_000);
    const refund = await ctx.t
      .http()
      .post(`/api/v1/admin/payments/${p.id}/refunds`)
      .set('authorization', finance.auth)
      .send({ amount: { amount: 100_000 }, reason: 'Недовложение', idempotencyKey: 'history-rf-1' })
      .expect(201);
    await ctx.t.drain();

    const detail = (await ctx.t.http().get(`/api/v1/admin/payments/${p.id}`).set('authorization', finance.auth).expect(200)).body;
    expect(detail.history.map((h: any) => [h.type, h.fromStatus, h.toStatus])).toEqual([
      ['status', null, 'created'],
      ['status', 'created', 'pending'],
      ['status', 'pending', 'succeeded'],
      ['refund_requested', null, null],
      ['status', 'succeeded', 'partially_refunded'],
      ['refund_succeeded', null, null],
    ]);
    expect(new Date(detail.history[0].at).getTime()).toBe(start);
    expect(new Date(detail.history[1].at).getTime()).toBeGreaterThanOrEqual(start + 60_000);
    expect(detail.history[3]).toMatchObject({ refundId: refund.body.id, amount: { amount: 100_000 }, reason: 'Недовложение', actorName: 'Финансист Алия' });
    expect(detail.refunds[0]).toMatchObject({ requestedBy: finance.userId, requestedByName: 'Финансист Алия', confirmedBy: null, confirmedByName: null });

    // Отмена по сроку: причина в истории; ручной возврат — кто подтвердил.
    const cancelled = await payments.createPayment(command({ method: 'online' }));
    await payments.cancelPayment(cancelled.id, 'order auto-cancelled');
    const cancelledDetail = (await ctx.t.http().get(`/api/v1/admin/payments/${cancelled.id}`).set('authorization', finance.auth)).body;
    expect(cancelledDetail.history.at(-1)).toMatchObject({ type: 'status', fromStatus: 'created', toStatus: 'cancelled', reason: 'order auto-cancelled', actorName: null });
    const cash = await payments.createPayment(command());
    await payments.markCollected(cash.id);
    const manual = await payments.requestRefund({ paymentId: cash.id, amount: tenge(500), reason: 'Сдача', idempotencyKey: 'history-m-1' });
    await ctx.t.http().post(`/api/v1/admin/payments/refunds/${manual.id}/confirm`).set('authorization', finance.auth).send({ comment: 'Наличными' }).expect(200);
    const queue = (await ctx.t.http().get('/api/v1/admin/payments/refunds?mode=manual').set('authorization', finance.auth)).body;
    expect(queue.items[0]).toMatchObject({ requestedBy: null, requestedByName: null, confirmedBy: finance.userId, confirmedByName: 'Финансист Алия' });
  });

  it('search: payments by customer phone; refund queue by period, reference, amount and order number', async () => {
    const aigerim = await payments.createPayment(command({ referenceId: 'order-aaa', customer: { phone: '+77015550011' }, description: 'Заказ GL-2026-000123' }));
    await payments.createPayment(command({ referenceId: 'order-bbb', customer: { phone: '+77779998877' } }));
    const finance = await tokenFor(ctx.t, [{ role: 'finance' }]);
    const byPhone = async (phone: string) =>
      (await ctx.t.http().get('/api/v1/admin/payments').query({ phone }).set('authorization', finance.auth).expect(200)).body.items.map((p: any) => p.id);
    expect(await byPhone('8 701 555 00 11')).toEqual([aigerim.id]);
    expect(await byPhone('0011')).toEqual([aigerim.id]);
    expect(await byPhone('12')).toHaveLength(2); // короче 4 цифр — фильтр не применяется

    await payments.markCollected(aigerim.id);
    const r1 = await payments.requestRefund({ paymentId: aigerim.id, amount: tenge(1500), reason: 'Сдача', idempotencyKey: 'q-1' });
    ctx.t.clock.advance(2 * 86_400_000);
    const r2 = await payments.requestRefund({ paymentId: aigerim.id, amount: tenge(700), reason: 'Ошибка', idempotencyKey: 'q-2' });
    const queue = async (query: Record<string, string>) =>
      (await ctx.t.http().get('/api/v1/admin/payments/refunds').query(query).set('authorization', finance.auth).expect(200)).body.items.map((r: any) => r.id);
    expect(await queue({ q: '1500' })).toEqual([r1.id]);
    expect(await queue({ q: '700.00' })).toEqual([r2.id]);
    expect(await queue({ q: 'GL-2026-000123' })).toEqual([r2.id, r1.id]);
    expect(await queue({ q: 'order-aaa' })).toEqual([r2.id, r1.id]);
    expect(await queue({ q: aigerim.id })).toEqual([r2.id, r1.id]);
    expect(await queue({ q: r1.id })).toEqual([r1.id]);
    const yesterday = new Date(ctx.t.clock.now().getTime() - 86_400_000).toISOString();
    expect(await queue({ from: yesterday })).toEqual([r2.id]);
    expect(await queue({ to: yesterday })).toEqual([r1.id]);
    expect((await ctx.t.http().get('/api/v1/admin/payments/refunds?from=yesterday').set('authorization', finance.auth)).status).toBe(400);
  });

  it('providers: configured providers and payment methods without secrets (payments.view)', async () => {
    const finance = await tokenFor(ctx.t, [{ role: 'finance' }]);
    let res = await ctx.t.http().get('/api/v1/admin/payments/providers').set('authorization', finance.auth).expect(200);
    // Маршрутизация не настроена: вне production — песочница по умолчанию.
    expect(res.body).toMatchObject({ routingConfigured: false, defaultProvider: 'sandbox' });
    expect(res.body.providers.find((p: any) => p.provider === 'sandbox')).toMatchObject({ isDefault: true, devFallback: true, enabled: true });
    expect(res.body.methods.map((m: any) => m.method).sort()).toEqual(['bank_transfer', 'gift_certificate', 'on_receipt', 'online']);

    await setIntegration(ctx, ROUTING_SETTINGS_KEY, { defaultProvider: 'halyk', branchOverrides: { [branchB]: 'kaspi' } });
    await setIntegration(ctx, HALYK_SETTINGS_KEY, { clientId: 'aula', terminalId: 'term-1', testMode: true }, { clientSecret: 'very-secret-value' });
    res = await ctx.t.http().get('/api/v1/admin/payments/providers').set('authorization', finance.auth).expect(200);
    expect(res.body).toMatchObject({ routingConfigured: true, defaultProvider: 'halyk' });
    expect(res.body.providers.find((p: any) => p.provider === 'halyk')).toMatchObject({ isDefault: true, enabled: true, title: 'Halyk ePay', branchIds: [] });
    expect(res.body.providers.find((p: any) => p.provider === 'kaspi')).toMatchObject({ isDefault: false, enabled: false, branchIds: [branchB] });
    expect(res.body.methods.find((m: any) => m.method === 'online')).toMatchObject({ provider: 'halyk', available: true });
    expect(JSON.stringify(res.body)).not.toContain('very-secret-value');
    // Управляющий филиала A не видит переопределения чужого филиала.
    const managerA = await tokenFor(ctx.t, [{ role: 'branch_manager', branchId: branchA }]);
    const scoped = await ctx.t.http().get('/api/v1/admin/payments/providers').set('authorization', managerA.auth).expect(200);
    expect(scoped.body.providers.find((p: any) => p.provider === 'kaspi').branchIds).toEqual([]);
    const content = await tokenFor(ctx.t, [{ role: 'content_manager' }]);
    expect((await ctx.t.http().get('/api/v1/admin/payments/providers').set('authorization', content.auth)).status).toBe(403);
  });

  it('confirming a gateway refund manually is refused', async () => {
    const p = await paidOnline(branchA);
    const r = await payments.requestRefund({ paymentId: p.id, reason: 'Отмена', idempotencyKey: 'gw-1' });
    const finance = await tokenFor(ctx.t, [{ role: 'finance' }]);
    const res = await ctx.t.http().post(`/api/v1/admin/payments/refunds/${r.id}/confirm`).set('authorization', finance.auth).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('refund.not_manual');
  });

  it('marks on_receipt payment collected from the admin', async () => {
    const p = await payments.createPayment(command());
    const operator = await tokenFor(ctx.t, [{ role: 'branch_operator', branchId: branchA }]);
    expect((await ctx.t.http().post(`/api/v1/admin/payments/${p.id}/collect`).set('authorization', operator.auth)).status).toBe(403);
    const finance = await tokenFor(ctx.t, [{ role: 'finance' }]);
    const list = await ctx.t.http().get('/api/v1/admin/payments').set('authorization', finance.auth);
    expect(list.body.items[0].canCollect).toBe(true);
    const res = await ctx.t.http().post(`/api/v1/admin/payments/${p.id}/collect`).set('authorization', finance.auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'succeeded', canCollect: false, canRefund: true });
    expect((await auditEntries(ctx.t, 'payment.collected'))[0]!.actor_kind).toBe('staff');
  });
});
