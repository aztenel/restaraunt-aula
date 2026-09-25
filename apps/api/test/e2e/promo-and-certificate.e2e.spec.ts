import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, createE2eApp, deliveries, deliveryDetail, E2E_TODAY, E2eContext, idem, money, pendingOutbox, sandboxPay } from './support/e2e-app';
import { adminOrder, advanceOrder, customerByPhone, paymentsOf, placeOrder, report, storefrontMenu, tracking } from './support/ordering';

const BUYER_PHONE = '+77012223344';
const RECIPIENT_PHONE = '+77019998877';
const CODE_RE = /\b([2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4})\b/;

/**
 * Сценарий 5: промокод + подарочный сертификат при оформлении. Сертификат покупается онлайн
 * (Payments: заказ сертификата → песочница → выпуск → PDF → сообщение получателю через SMS-шлюз),
 * код берётся из отправленного SMS. Затем: заказ с WELCOME10 и сертификатом + онлайн-остаток,
 * отказ ресторана → деньги возвращаются провайдером, списание — на сертификат; второй заказ целиком
 * сертификатом (частичное погашение). Проверка баланса и отчётов обоих модулей.
 */
describe('E2E 5: promo code + gift certificate at checkout', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await ctx.reset();
    await ctx.configureIntegration('notifications.mobizon', { enabled: true, config: {}, secrets: { apiKey: 'mobizon-test-key-0001' } });
    ctx.net.on('mobizon', 200, { code: 0, data: { messageId: '1' } });
  });

  function smsTexts(): string[] {
    return ctx.net.requests.filter((r) => r.url.includes('mobizon')).map((r) => new URLSearchParams(r.body ?? '').get('text') ?? '');
  }

  async function checkBalance(code: string): Promise<any> {
    return (await ctx.api().post('/api/v1/public/certificates/check').send({ code }).expect(200)).body;
  }

  /** Покупка сертификата на 20 000 ₸ с отправкой получателю в WhatsApp (резерв — SMS). */
  async function buyCertificate(): Promise<{ code: string; certificateId: string; orderId: string }> {
    const products = await ctx.api().get('/api/v1/public/certificates/products').query({ locale: 'ru' }).expect(200);
    const product = (products.body as any[]).find((p) => p.slug === 'nominal-20000');
    expect(product).toMatchObject({ kind: 'amount', nominal: money(20_000), price: money(20_000), validityMonths: 12 });
    const purchase = await ctx
      .api()
      .post('/api/v1/public/certificates/purchase')
      .send({
        productId: product.id,
        quantity: 1,
        buyer: { name: 'Динара', phone: BUYER_PHONE, email: 'dinara@example.kz' },
        recipient: { name: 'Данияр', phone: RECIPIENT_PHONE },
        message: 'С днём рождения!',
        deliveryChannel: 'whatsapp',
        consent: { personalData: true, marketing: false },
        locale: 'ru',
        idempotencyKey: idem('cert'),
      })
      .expect(201);
    expect(purchase.body).toMatchObject({ status: 'awaiting_payment', total: money(20_000), payment: { status: 'created', paymentUrl: null } });
    await ctx.drain();
    let status = await ctx.api().get(`/api/v1/public/certificates/orders/${purchase.body.orderToken}`).expect(200);
    expect(status.body.payment.paymentUrl).toContain('/public/payments/sandbox/');
    await sandboxPay(ctx, status.body.payment.paymentUrl);
    await ctx.drain();
    status = await ctx.api().get(`/api/v1/public/certificates/orders/${purchase.body.orderToken}`).expect(200);
    expect(status.body).toMatchObject({ status: 'issued', recipientName: 'Данияр', certificates: [{ status: 'active' }] });
    expect(status.body.issuedAt).toBeTruthy();

    // Код показывается один раз — в сообщении получателю (WhatsApp не настроен → резерв SMS) и в PDF.
    const texts = smsTexts().filter((t) => CODE_RE.test(t));
    expect(texts).toHaveLength(1);
    const code = CODE_RE.exec(texts[0]!)![1]!;
    expect(status.body.certificates[0].maskedCode).toBe(`****-****-${code.slice(-4)}`);
    const [issued] = await deliveries(ctx, { template: 'certificate.issued' });
    expect(issued).toMatchObject({ channel: 'sms', provider: 'mobizon', status: 'sent', related: { type: 'gift_certificate' } });
    const detail = await deliveryDetail(ctx, issued!.id);
    expect(detail.params.code).toBe('***');
    expect(detail.renderedText).not.toContain(code);
    expect(detail.params.pdfUrl).toContain('sig');
    return { code, certificateId: issued!.related!.id, orderId: purchase.body.orderId };
  }

  it('buy certificate → order with promo + certificate + online remainder → reject → money refunded and certificate credited → second order paid by certificate', async () => {
    const { greenline } = ctx.seed.branches;
    const cert = await buyCertificate();
    expect(await checkBalance(cert.code)).toMatchObject({ status: 'active', nominal: money(20_000), balance: money(20_000), kind: 'amount' });
    // Продажа сертификата — выручка канала «сертификаты» в день продажи.
    let revenue = await report(ctx, 'revenue', { from: E2E_TODAY, to: E2E_TODAY });
    expect(revenue.totals).toMatchObject({ certificate: money(20_000), total: money(20_000) });

    // ---------------------------------------------------------------- Заказ: WELCOME10 + сертификат + онлайн-остаток
    const menu = await storefrontMenu(ctx, 'greenline');
    const ribeye = menu.get('steyk-ribay')!;
    expect(ribeye.price).toEqual(money(12_900));
    const items = [{ dishId: ribeye.id, quantity: 2 }];
    // 25 800 ₸ − 10% (2 580) = 23 220 ₸ → сертификатом 20 000, онлайн 3 220.
    const quote = await ctx
      .api()
      .post('/api/v1/public/orders/quote')
      .send({ branchId: greenline, type: 'pickup', items, promoCode: 'welcome10', certificateCode: cert.code.toLowerCase(), phone: BUYER_PHONE })
      .expect(200);
    expect(quote.body).toMatchObject({
      subtotal: money(25_800),
      discount: money(2_580),
      total: money(23_220),
      amountDue: money(3_220),
      promo: { code: 'WELCOME10', applied: true, discount: money(2_580) },
      certificate: { applied: true, amount: money(20_000), balance: money(20_000), maskedCode: `****-****-${cert.code.slice(-4)}` },
      canCheckout: true,
    });

    const placed = await placeOrder(ctx, {
      branchId: greenline,
      type: 'pickup',
      items,
      paymentMethod: 'online',
      phone: BUYER_PHONE,
      name: 'Динара',
      promoCode: 'WELCOME10',
      certificateCode: cert.code,
    });
    expect(placed.body).toMatchObject({ status: 'awaiting_payment', total: money(23_220), payment: { method: 'online', amount: money(3_220) } });
    const orderId = placed.orderId;
    // Сертификат списан сразу (отдельный платёж gift_certificate), остаток ждёт онлайн-оплату.
    expect(await checkBalance(cert.code)).toMatchObject({ status: 'redeemed', balance: money(0) });
    await ctx.drain();
    let track = await tracking(ctx, placed.publicToken);
    expect(track.payment).toMatchObject({ certificateAmount: money(20_000), amountDue: money(3_220), isPaid: false });
    await sandboxPay(ctx, track.payment.current.paymentUrl);
    await ctx.drain();
    track = await tracking(ctx, placed.publicToken);
    expect(track).toMatchObject({ status: 'paid', promoCode: 'WELCOME10', discount: money(2_580) });
    const orderPayments = await paymentsOf(ctx, orderId);
    expect(orderPayments.map((p) => [p.method, p.status, p.amount.amount]).sort()).toEqual([
      ['gift_certificate', 'succeeded', 2_000_000],
      ['online', 'succeeded', 322_000],
    ]);
    // Держатель сертификата получает сообщение о списании.
    expect((await deliveries(ctx, { template: 'certificate.redeemed' })).map((d) => d.status)).toEqual(['sent']);

    // Промокод на один телефон использован: повторно не применяется.
    const again = await ctx
      .api()
      .post('/api/v1/public/orders/quote')
      .send({ branchId: greenline, type: 'pickup', items, promoCode: 'WELCOME10', phone: BUYER_PHONE })
      .expect(200);
    expect(again.body.promo).toMatchObject({ applied: false });
    expect(again.body.canCheckout).toBe(false);

    // ---------------------------------------------------------------- Отказ ресторана: полный возврат
    const manager = await ctx.staff([{ role: 'branch_manager', branchId: greenline }], 'Управляющий GL');
    await ctx.api().post(`/api/v1/admin/orders/${orderId}/reject`).set('Authorization', manager.auth).send({ reasonCode: 'cannot_deliver' }).expect(200);
    await ctx.drain();
    expect(await pendingOutbox(ctx)).toEqual([]);
    const details = await adminOrder(ctx, orderId, manager.auth);
    expect(details.status).toBe('refunded');
    expect(details.refunds.map((r: any) => [r.status, r.amount.amount]).sort((a: any, b: any) => a[1] - b[1])).toEqual([
      ['succeeded', 322_000],
      ['succeeded', 2_000_000],
    ]);
    const refundedPayments = await paymentsOf(ctx, orderId);
    expect(refundedPayments.map((p) => [p.method, p.status]).sort()).toEqual([
      ['gift_certificate', 'refunded'],
      ['online', 'refunded'],
    ]);
    // Списание вернулось на сертификат: снова активен, баланс полный.
    expect(await checkBalance(cert.code)).toMatchObject({ status: 'active', balance: money(20_000) });
    const certAudit = (await auditLog(ctx, { entityId: cert.certificateId })).map((a) => a.action);
    expect(certAudit).toEqual(expect.arrayContaining(['certificate.issued', 'certificate.redeemed', 'certificate.credited']));

    // ---------------------------------------------------------------- Второй заказ целиком сертификатом (частичное погашение)
    const achichuk = menu.get('achichuk')!;
    const kazy = menu.get('kazy')!;
    const second = await placeOrder(ctx, {
      branchId: greenline,
      type: 'pickup',
      items: [
        { dishId: achichuk.id, quantity: 1 },
        { dishId: kazy.id, quantity: 1 },
      ],
      paymentMethod: 'online',
      phone: BUYER_PHONE,
      name: 'Динара',
      certificateCode: cert.code,
    });
    // 1 900 + 4 900 = 6 800 ₸ — остаток нулевой, заказ оплачен сразу, онлайн-платежа нет.
    expect(second.body).toMatchObject({ status: 'paid', total: money(6_800), payment: null });
    expect(await checkBalance(cert.code)).toMatchObject({ status: 'active', balance: money(13_200) });
    for (const to of ['accepted', 'cooking', 'ready', 'completed']) await advanceOrder(ctx, second.orderId, manager.auth, to);
    await ctx.drain();

    // Админка сертификатов: та же картина с точки (проверка кода сотрудником).
    const adminCheck = await ctx.api().post('/api/v1/admin/certificates/check').set('Authorization', manager.auth).send({ code: cert.code }).expect(200);
    expect(adminCheck.body).toMatchObject({ id: cert.certificateId, balance: money(13_200), status: 'active' });

    // ---------------------------------------------------------------- Отчёты: модуль сертификатов и Reporting согласованы
    const own = await ctx.api().get('/api/v1/admin/certificates/report').query({ from: E2E_TODAY, to: E2E_TODAY }).set('Authorization', await ctx.owner()).expect(200);
    expect(own.body).toMatchObject({
      issued: { count: 1, nominal: money(20_000) },
      redeemed: { amount: money(26_800) },
      returned: { count: 1, amount: money(20_000) },
      liability: { active: { count: 1, amount: money(13_200) } },
    });
    const rep = await report(ctx, 'certificates', { from: E2E_TODAY, to: E2E_TODAY });
    expect(rep.issued).toMatchObject({ count: 1, nominal: money(20_000), price: money(20_000) });
    // Погашено 26 800 (как в отчёте модуля платежей), из них 20 000 возвращено на сертификат при отмене заказа.
    expect(rep.redeemed).toMatchObject({ count: 2, amount: own.body.redeemed.amount });
    expect(rep.returned).toEqual({ count: 1, amount: money(20_000) });
    expect(rep.outstanding).toMatchObject({ count: 1, balance: money(13_200) });
    expect(rep.outstanding.balance).toEqual(own.body.liability.active.amount);

    revenue = await report(ctx, 'revenue', { from: E2E_TODAY, to: E2E_TODAY });
    // Выручка: сертификат при продаже + выполненный заказ (оплата сертификатом — не новая выручка по деньгам,
    // но заказ выполнен на 6 800 ₸; отменённый заказ выручки не даёт).
    expect(revenue.totals).toMatchObject({ certificate: money(20_000), pickup: money(6_800), total: money(26_800) });
    const cash = await report(ctx, 'payments', { from: E2E_TODAY, to: E2E_TODAY });
    // Деньгами: покупка сертификата 20 000 + онлайн-остаток 3 220; оплаты сертификатом (20 000 + 6 800) — не деньги.
    expect(cash.totals).toMatchObject({ moneyReceived: money(23_220), certificateRedemptions: money(26_800) });

    const buyer = await customerByPhone(ctx, BUYER_PHONE);
    expect(buyer.customer).toMatchObject({ ordersCount: 2, completedOrdersCount: 1 });
    expect(buyer.activities.items.map((a: any) => a.type)).toEqual(expect.arrayContaining(['certificate_purchased', 'order_placed', 'order_completed', 'order_cancelled']));
  });
});
