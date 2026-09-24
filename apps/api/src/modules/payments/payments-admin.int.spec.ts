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
