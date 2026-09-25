import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, createE2eApp, deliveries, deliveryDetail, E2E_TODAY, E2eContext, feed, money } from './support/e2e-app';
import { adminOrder, advanceOrder, checkoutBody, customerByPhone, paymentsOf, placeOrder, report, storefrontMenu, tracking } from './support/ordering';

const PHONE = '+77051234567';

/**
 * Сценарий 2: самовывоз с оплатой при получении. Телефон подтверждается НАСТОЯЩИМ SMS-кодом:
 * Customers ставит уведомление otp.code → Notifications доставляет его через SMS-шлюз Mobizon
 * (сеть подменена), код извлекается из запроса к шлюзу → токен → заказ сразу paid («оплата обеспечена»)
 * → выдача → платёж on_receipt отмечен полученным (Payments) → выручка самовывоза.
 */
describe('E2E 2: pay-on-receipt pickup order with SMS phone verification', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await ctx.reset();
  });

  async function requestOtp(): Promise<{ verificationId: string; code: string }> {
    const before = ctx.net.requests.length;
    const started = await ctx.api().post('/api/v1/public/phone-verifications').send({ phone: '8 (705) 123-45-67', locale: 'ru' }).expect(201);
    expect(started.body).toMatchObject({ verificationId: expect.any(String), resendAfterSeconds: 60 });
    // Код уходит задачей доставки уведомлений через SMS-шлюз.
    expect(ctx.net.requests.length).toBe(before);
    await ctx.drain();
    const sms = ctx.net.requests.slice(before).filter((r) => r.url.includes('mobizon'));
    expect(sms).toHaveLength(1);
    const form = new URLSearchParams(sms[0]!.body ?? '');
    expect(form.get('recipient')).toBe('77051234567');
    const code = /\b(\d{4})\b/.exec(form.get('text') ?? '')?.[1];
    expect(code, `OTP code in SMS text: ${form.get('text')}`).toBeTruthy();
    return { verificationId: started.body.verificationId, code: code! };
  }

  it('SMS code → verified token → on_receipt order paid immediately → pickup lifecycle → payment collected', async () => {
    const { greenline } = ctx.seed.branches;
    // Администратор системы подключает SMS-шлюз (ключ — секрет, хранится зашифрованным).
    await ctx.configureIntegration('notifications.mobizon', { enabled: true, config: { from: 'AULA' }, secrets: { apiKey: 'mobizon-test-key-0001' } });
    ctx.net.on('mobizon', 200, { code: 0, data: { messageId: '9001' }, message: '' });

    const menu = await storefrontMenu(ctx, 'greenline');
    const plov = menu.get('plov')!;
    const baursaki = menu.get('baursaki')!;
    const items = [
      { dishId: plov.id, quantity: 2 },
      { dishId: baursaki.id, quantity: 1 },
    ];
    // 3 500 * 2 + 1 200 = 8 200 ₸, самовывоз без доставки.

    // Без подтверждения телефона оплата при получении не принимается (настройка филиала по умолчанию).
    const unverified = await ctx.api().post('/api/v1/public/orders').send(checkoutBody({ branchId: greenline, type: 'pickup', items, paymentMethod: 'on_receipt', phone: PHONE }));
    expect(unverified.status).toBe(422);
    expect(unverified.body.error.code).toBe('phone.not_verified');

    const { verificationId, code } = await requestOtp();
    // Журнал доставки: SMS через mobizon, код в журнале скрыт.
    const [otpDelivery] = await deliveries(ctx, { template: 'otp.code' });
    expect(otpDelivery).toMatchObject({ channel: 'sms', provider: 'mobizon', status: 'sent', audience: 'guest', related: { type: 'phone_verification', id: verificationId } });
    const otpDetail = await deliveryDetail(ctx, otpDelivery!.id);
    expect(otpDetail.params.code).toBe('***');
    expect(otpDetail.renderedText).not.toContain(code);
    // Журнал интеграций хранит обмен с шлюзом без кода и ключа.
    const logs = await ctx.api().get('/api/v1/admin/system/integration-logs').query({ integration: 'notifications.mobizon' }).set('Authorization', await ctx.sysadmin()).expect(200);
    expect(logs.body.items.length).toBeGreaterThan(0);
    const logText = JSON.stringify(logs.body.items);
    expect(logText).not.toContain(code);
    expect(logText).not.toContain('mobizon-test-key-0001');

    // Неверный код — 422, верный — токен подтверждения.
    const wrong = code === '0000' ? '1111' : '0000';
    const bad = await ctx.api().post(`/api/v1/public/phone-verifications/${verificationId}/verify`).send({ code: wrong });
    expect(bad.status).toBe(422);
    const verified = await ctx.api().post(`/api/v1/public/phone-verifications/${verificationId}/verify`).send({ code }).expect(200);
    expect(verified.body).toMatchObject({ phone: PHONE, token: expect.any(String) });

    // Токен подтверждает только свой номер.
    const otherPhone = await ctx
      .api()
      .post('/api/v1/public/orders')
      .send(checkoutBody({ branchId: greenline, type: 'pickup', items, paymentMethod: 'on_receipt', phone: '+77059999999', phoneVerificationToken: verified.body.token }));
    expect(otherPhone.status).toBe(422);

    const operator = await ctx.staff([{ role: 'branch_operator', branchId: greenline }], 'Оператор GL', { phone: '+77010000555' });
    const placed = await placeOrder(ctx, {
      branchId: greenline,
      type: 'pickup',
      items,
      paymentMethod: 'on_receipt',
      phone: PHONE,
      name: 'Ерлан',
      phoneVerificationToken: verified.body.token,
    });
    // «Оплата обеспечена»: заказ сразу paid, платёж при получении ждёт денег.
    expect(placed.body).toMatchObject({ status: 'paid', total: money(8_200), payment: { method: 'on_receipt', status: 'pending', amount: money(8_200) } });
    const orderId = placed.orderId;
    await ctx.drain();

    let [payment] = await paymentsOf(ctx, orderId);
    expect(payment).toMatchObject({ method: 'on_receipt', provider: 'on_receipt', status: 'pending', canCollect: true });
    const track = await tracking(ctx, placed.publicToken);
    expect(track).toMatchObject({ status: 'paid', type: 'pickup', delivery: null, payment: { method: 'on_receipt', isPaid: true, amountDue: money(8_200) } });

    // Персонал узнаёт о новом заказе сразу (не ждём онлайн-оплату), в ленте — со звуком.
    expect((await feed(ctx)).filter((f) => f.entityId === orderId && f.kind === 'created' && f.sound)).toHaveLength(1);
    const staffNew = await deliveries(ctx, { relatedId: orderId, template: 'staff.order_new' });
    expect(staffNew).toEqual([expect.objectContaining({ recipientName: 'Оператор GL', channel: 'whatsapp', status: 'sent' })]);

    await advanceOrder(ctx, orderId, operator.auth, 'accepted');
    await advanceOrder(ctx, orderId, operator.auth, 'cooking');
    await advanceOrder(ctx, orderId, operator.auth, 'ready');
    const ready = await adminOrder(ctx, orderId, operator.auth);
    // Самовывоз: «в пути» не бывает.
    expect(ready.allowedTransitions).toEqual(['completed']);
    await ctx.api().post(`/api/v1/admin/orders/${orderId}/transition`).set('Authorization', operator.auth).send({ to: 'delivering' }).expect(409);
    await advanceOrder(ctx, orderId, operator.auth, 'completed');
    await ctx.drain();

    // Деньги получены при выдаче: платёж on_receipt → succeeded (раздел платежей админки).
    [payment] = await paymentsOf(ctx, orderId);
    expect(payment).toMatchObject({ method: 'on_receipt', status: 'succeeded', canCollect: false, amount: money(8_200) });
    expect(payment.paidAt).toBeTruthy();
    const paymentAudit = await auditLog(ctx, { entityId: payment.id });
    expect(paymentAudit.map((a) => a.action)).toContain('payment.collected');

    const guestTemplates = (await deliveries(ctx, { relatedId: orderId, audience: 'guest' })).map((d) => d.template).sort();
    expect(guestTemplates).toEqual(['order.accepted', 'order.completed', 'order.created', 'order.ready']);

    const revenue = await report(ctx, 'revenue', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(revenue.totals).toMatchObject({ pickup: money(8_200), delivery: money(0), total: money(8_200) });
    expect(revenue.counts).toMatchObject({ pickup: 1 });
    const cash = await report(ctx, 'payments', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(cash.methods).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'on_receipt', received: money(8_200), receivedCount: 1 })]));

    const guest = await customerByPhone(ctx, PHONE);
    expect(guest.customer).toMatchObject({ name: 'Ерлан', ordersCount: 1, completedOrdersCount: 1, totalSpent: money(8_200) });
  });

  it('SMS gateway outage does not block the order: OTP is retried with backoff and delivered later', async () => {
    await ctx.configureIntegration('notifications.mobizon', { enabled: true, config: {}, secrets: { apiKey: 'mobizon-test-key-0001' } });
    ctx.net.on('mobizon', 503, 'Service Unavailable', { times: 1 });
    ctx.net.on('mobizon', 200, { code: 0, data: { messageId: '9002' } });
    const started = await ctx.api().post('/api/v1/public/phone-verifications').send({ phone: PHONE, locale: 'kk' }).expect(201);
    await ctx.drain();
    let [otp] = await deliveries(ctx, { template: 'otp.code' });
    expect(otp).toMatchObject({ status: 'pending', related: { id: started.body.verificationId } });
    await ctx.drain(10_000); // повтор задачи доставки через 5 с
    [otp] = await deliveries(ctx, { template: 'otp.code' });
    expect(otp).toMatchObject({ status: 'sent', provider: 'mobizon', attempts: 2 });
    expect(ctx.net.requests.filter((r) => r.url.includes('mobizon'))).toHaveLength(2);
  });
});
