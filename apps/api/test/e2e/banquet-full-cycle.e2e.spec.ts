import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, createE2eApp, deliveries, E2eContext, feed, money, outboxEvents, pendingOutbox, sandboxPay } from './support/e2e-app';
import { customerByPhone, paymentsOf, report } from './support/ordering';

const CONTACT_PHONE = '+77026667788';

function tokenOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.split('/').pop()!);
}

/**
 * Сценарий 8: банкет от заявки с витрины до проведения. Banquet (автоназначение настоящему менеджеру
 * из Identity, SLA, смета с ценами меню филиала из Catalog, согласование по ссылке, счета) → Payments
 * (онлайн-оплата физлица в песочнице, перевод юрлица) → Banquet (prepaid, held) → Reporting (выручка
 * банкетов, воронка) → Customers (теги banquet/corporate, история) → Notifications.
 */
describe('E2E 8: banquet full cycle with real payments', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await ctx.reset();
  });

  it('public request → auto-assign → SLA breach → quote from branch menu → accept → invoices (online + company transfer) → prepaid → held → reports', async () => {
    const { greenline } = ctx.seed.branches;
    const manager = await ctx.staff([{ role: 'banquet_manager' }], 'Банкетный менеджер (тест)', { phone: '+77010000777' });
    const owner = await ctx.staff([{ role: 'owner' }], 'Собственник (тест)', { phone: '+77010000888' });
    const finance = await ctx.staff([{ role: 'finance' }], 'Финансы (тест)');

    // Демо-менеджер уже ведёт одну заявку (сид) → новая достаётся наименее загруженному — нашему.
    const managers = await ctx.api().get('/api/v1/admin/banquets/managers').set('Authorization', manager.auth).expect(200);
    expect(managers.body.map((m: any) => m.name)).toEqual(expect.arrayContaining(['Банкетный менеджер', 'Банкетный менеджер (тест)']));

    // ---------------------------------------------------------------- Заявка с витрины
    const created = await ctx
      .api()
      .post('/api/v1/public/banquets/requests')
      .send({
        eventDate: '2026-10-20',
        eventTime: '18:00',
        eventType: 'anniversary',
        guests: 30,
        branchId: greenline,
        budget: money(400_000),
        contact: { name: 'Гульнара', phone: '8 702 666 77 88', email: 'gulnara@example.kz' },
        wishes: 'Юбилей мамы, национальная кухня',
        consent: { personalData: true, marketing: true },
        locale: 'ru',
      })
      .expect(201);
    expect(created.body).toMatchObject({ status: 'new', managerName: 'Банкетный менеджер (тест)', managerPhone: '+77010000777' });
    expect(created.body.number).toMatch(/^GL-/);
    await ctx.drain();
    const list = await ctx.api().get('/api/v1/admin/banquets/requests').query({ q: created.body.number }).set('Authorization', manager.auth).expect(200);
    const requestId: string = list.body.items[0].id;
    let detail = (await ctx.api().get(`/api/v1/admin/banquets/requests/${requestId}`).set('Authorization', manager.auth).expect(200)).body;
    expect(detail).toMatchObject({ status: 'new', managerId: manager.userId, source: 'web', guests: 30 });

    expect((await deliveries(ctx, { relatedId: requestId, template: 'banquet.request_received' })).map((d) => d.status)).toEqual(['sent']);
    expect(await deliveries(ctx, { relatedId: requestId, template: 'staff.banquet_new' })).toEqual([
      expect.objectContaining({ recipientName: 'Банкетный менеджер (тест)', status: 'sent' }),
    ]);
    expect((await feed(ctx)).some((f) => f.entityId === requestId && f.stream === 'banquets' && f.kind === 'created' && f.sound)).toBe(true);
    const createdEvent = (await outboxEvents(ctx, 'banquet.request_created')).find((e) => e.payload.requestId === requestId)!;
    expect(createdEvent.payload).toMatchObject({ managerId: manager.userId, source: 'web', contact: { phone: CONTACT_PHONE } });

    // ---------------------------------------------------------------- SLA: 30 минут без ответа → эскалация
    ctx.t.clock.advance(29 * 60_000);
    await ctx.t.runSchedule('banquet.sla_check');
    await ctx.drain();
    expect(await deliveries(ctx, { relatedId: requestId, template: 'staff.banquet_sla_breach' })).toEqual([]);
    ctx.t.clock.advance(2 * 60_000);
    await ctx.t.runSchedule('banquet.sla_check');
    await ctx.t.runSchedule('banquet.sla_check'); // повторная проверка не дублирует уведомление
    await ctx.drain();
    const breach = await deliveries(ctx, { relatedId: requestId, template: 'staff.banquet_sla_breach' });
    expect(breach.map((d) => d.recipientName).sort()).toEqual(['Банкетный менеджер (тест)', 'Собственник (тест)']);
    expect((await feed(ctx)).some((f) => f.entityId === requestId && f.title.includes('без ответа') && f.sound)).toBe(true);
    const sla = await ctx.api().get('/api/v1/admin/banquets/requests').query({ slaBreached: true }).set('Authorization', owner.auth).expect(200);
    expect(sla.body.items.map((r: any) => r.id)).toContain(requestId);

    // Менеджер перезванивает (первый ответ) и берёт заявку в работу.
    await ctx.api().post(`/api/v1/admin/banquets/requests/${requestId}/activities`).set('Authorization', manager.auth).send({ kind: 'call', text: 'Обсудили меню' }).expect(201);
    await ctx.api().post(`/api/v1/admin/banquets/requests/${requestId}/transition`).set('Authorization', manager.auth).send({ to: 'in_progress' }).expect(200);

    // ---------------------------------------------------------------- Смета: блюда меню филиала + произвольные позиции
    const dishes = await ctx.api().get('/api/v1/admin/banquets/menu/dishes').query({ branchId: greenline, q: 'Бешбармак' }).set('Authorization', manager.auth).expect(200);
    const beshbarmak = dishes.body.find((d: any) => d.name.ru === 'Бешбармак');
    expect(beshbarmak).toMatchObject({ price: money(5_900), availability: 'available' }); // цена GreenLine (в Garden View — 6 300)
    const quote = await ctx
      .api()
      .post(`/api/v1/admin/banquets/requests/${requestId}/quotes`)
      .set('Authorization', manager.auth)
      .send({
        lines: [
          { kind: 'menu', dishId: beshbarmak.dishId, quantity: 30 },
          { kind: 'hall_rent', title: { ru: 'Аренда VIP-зала' }, unit: 'усл.', unitPrice: { amount: 10_000_000 }, quantity: 1 },
        ],
        serviceChargeBp: 1000,
      })
      .expect(201);
    // 30 × 5 900 + 100 000 = 277 000; обслуживание 10% = 27 700; итог 304 700 ₸.
    expect(quote.body.lines[0]).toMatchObject({ kind: 'menu', dishId: beshbarmak.dishId, title: { ru: 'Бешбармак' }, unitPrice: money(5_900), total: money(177_000) });
    expect(quote.body.totals).toMatchObject({ subtotal: money(277_000), service: money(27_700), total: money(304_700), vat: money(0) });
    expect(quote.body.version).toBe(1);

    await ctx.api().post(`/api/v1/admin/banquets/quotes/${quote.body.id}/send`).set('Authorization', manager.auth).expect(200);
    await ctx.drain();
    detail = (await ctx.api().get(`/api/v1/admin/banquets/requests/${requestId}`).set('Authorization', manager.auth).expect(200)).body;
    expect(detail.status).toBe('quote_sent');
    expect((await deliveries(ctx, { relatedId: requestId, template: 'banquet.quote_sent' })).map((d) => d.status)).toEqual(['sent']);

    // ---------------------------------------------------------------- Клиент согласует смету по ссылке
    const quoteToken = tokenOf(detail.publicQuoteUrl);
    const publicQuote = await ctx.api().get(`/api/v1/public/banquets/quotes/${quoteToken}`).expect(200);
    expect(publicQuote.body).toMatchObject({ version: 1, canAccept: true, total: money(304_700), guests: 30 });
    const accepted = await ctx.api().post(`/api/v1/public/banquets/quotes/${quoteToken}/accept`).send({ version: 1 }).expect(200);
    expect(accepted.body).toMatchObject({ status: 'agreed', version: 1, prepayment: money(152_350) });

    // ---------------------------------------------------------------- Счёт физлицу на предоплату: онлайн-оплата
    const individual = await ctx.api().post(`/api/v1/admin/banquets/requests/${requestId}/invoices`).set('Authorization', manager.auth).send({ payerType: 'individual' }).expect(201);
    expect(individual.body).toMatchObject({ payerType: 'individual', purpose: 'prepayment', amount: money(152_350), status: 'issued' });
    await ctx.drain();
    const invoiceToken = tokenOf(individual.body.publicUrl);
    let publicInvoice = await ctx.api().get(`/api/v1/public/banquets/invoices/${invoiceToken}`).expect(200);
    expect(publicInvoice.body).toMatchObject({ status: 'issued', amount: money(152_350), remaining: money(152_350), paymentStatus: 'pending' });
    // Админка видит ту же ссылку на оплату и может отправить её гостю ещё раз.
    const adminInvoice = await ctx.api().get(`/api/v1/admin/banquets/invoices/${individual.body.id}`).set('Authorization', manager.auth).expect(200);
    expect(adminInvoice.body).toMatchObject({ paymentUrl: publicInvoice.body.paymentUrl, paymentStatus: 'pending', canResendPaymentLink: true, refunds: [] });
    await ctx.api().post(`/api/v1/admin/banquets/invoices/${individual.body.id}/payment-link`).set('Authorization', manager.auth).send({}).expect(200);
    await sandboxPay(ctx, publicInvoice.body.paymentUrl);
    await ctx.drain();
    publicInvoice = await ctx.api().get(`/api/v1/public/banquets/invoices/${invoiceToken}`).expect(200);
    expect(publicInvoice.body).toMatchObject({ status: 'paid', paid: money(152_350), remaining: money(0), paymentStatus: 'succeeded' });
    detail = (await ctx.api().get(`/api/v1/admin/banquets/requests/${requestId}`).set('Authorization', manager.auth).expect(200)).body;
    // Предоплата покрыта → заявка автоматически agreed → prepaid.
    expect(detail).toMatchObject({ status: 'prepaid', prepayment: { required: money(152_350), paid: money(152_350), covered: true } });
    expect((await deliveries(ctx, { relatedId: requestId, template: 'banquet.payment_received' })).length).toBe(1);
    const [onlinePayment] = await paymentsOf(ctx, individual.body.id);
    expect(onlinePayment).toMatchObject({ purpose: 'banquet_invoice', method: 'online', status: 'succeeded', amount: money(152_350) });
    const paidInvoice = detail.invoices.find((i: { id: string }) => i.id === individual.body.id);
    expect(paidInvoice).toMatchObject({ paymentUrl: null, paymentStatus: 'succeeded', canResendPaymentLink: false });
    expect(paidInvoice.payments[0]).toMatchObject({ method: 'online', refundable: money(152_350) });
    expect(detail).toMatchObject({ canIssueInvoice: true, canIssueAct: false, canEditQuote: false });

    // ---------------------------------------------------------------- Остаток — юрлицу: счёт с реквизитами и перевод
    const company = await ctx
      .api()
      .post('/api/v1/admin/banquets/companies')
      .set('Authorization', manager.auth)
      .send({ name: 'ТОО «Ромашка»', bin: '940140001234', legalAddress: 'Астана, ул. Сыганак, 10', bankName: 'АО «Halyk Bank»', iban: 'KZ123456789012345678', bik: 'HSBKKZKX', kbe: '17', directorName: 'Сейтжанов А.', directorPosition: 'Директор' })
      .expect(201);
    const companyInvoice = await ctx
      .api()
      .post(`/api/v1/admin/banquets/requests/${requestId}/invoices`)
      .set('Authorization', finance.auth)
      .send({ payerType: 'company', companyId: company.body.id })
      .expect(201);
    expect(companyInvoice.body).toMatchObject({ payerType: 'company', amount: money(152_350), buyer: { name: 'ТОО «Ромашка»', bin: '940140001234' } });
    // Счёт на сумму сверх итога сметы не выставляется.
    const overInvoice = await ctx
      .api()
      .post(`/api/v1/admin/banquets/requests/${requestId}/invoices`)
      .set('Authorization', finance.auth)
      .send({ payerType: 'company', companyId: company.body.id, amount: { amount: 100 } });
    expect(overInvoice.status).toBe(422);
    expect(overInvoice.body.error.code).toBe('banquet_invoice.exceeds_quote');
    // Переплата по счёту отклоняется (сумма оплат не превышает сумму счёта).
    const paidAt = '2026-10-01T11:10:00+05:00'; // по выписке банка (не в будущем)
    const over = await ctx
      .api()
      .post(`/api/v1/admin/banquets/invoices/${companyInvoice.body.id}/payments`)
      .set('Authorization', finance.auth)
      .send({ amount: { amount: 15_235_001 }, paidAt, documentNumber: 'PP-771' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('banquet_invoice.overpayment');
    const transfer = await ctx
      .api()
      .post(`/api/v1/admin/banquets/invoices/${companyInvoice.body.id}/payments`)
      .set('Authorization', finance.auth)
      .send({ amount: { amount: 15_235_000 }, paidAt, documentNumber: 'PP-771' })
      .expect(201);
    expect(transfer.body).toMatchObject({ duplicate: false, invoice: { status: 'paid', paid: money(152_350) } });
    const again = await ctx
      .api()
      .post(`/api/v1/admin/banquets/invoices/${companyInvoice.body.id}/payments`)
      .set('Authorization', finance.auth)
      .send({ amount: { amount: 15_235_000 }, paidAt, documentNumber: 'PP-771' })
      .expect(201);
    expect(again.body).toMatchObject({ duplicate: true, paymentId: transfer.body.paymentId });
    await ctx.drain();
    const [bankPayment] = await paymentsOf(ctx, companyInvoice.body.id);
    expect(bankPayment).toMatchObject({ method: 'bank_transfer', status: 'succeeded', amount: money(152_350) });
    detail = (await ctx.api().get(`/api/v1/admin/banquets/requests/${requestId}`).set('Authorization', manager.auth).expect(200)).body;
    expect(detail.balance).toMatchObject({ quoteTotal: money(304_700), paid: money(304_700), remaining: money(0) });
    // Мероприятие ещё не наступило — «проведено» недоступно.
    expect(detail.allowedTransitions).not.toContain('held');
    const early = await ctx.api().post(`/api/v1/admin/banquets/requests/${requestId}/transition`).set('Authorization', manager.auth).send({ to: 'held' });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toMatch(/^banquet\./);

    // ---------------------------------------------------------------- День мероприятия: проведено
    ctx.t.clock.set(new Date('2026-10-20T17:00:00.000Z')); // 22:00 по Астане
    await ctx.api().post(`/api/v1/admin/banquets/requests/${requestId}/transition`).set('Authorization', manager.auth).send({ to: 'held' }).expect(200);
    await ctx.drain();
    expect(await pendingOutbox(ctx)).toEqual([]);
    const statusAudit = (await auditLog(ctx, { entityId: requestId, action: 'banquet.status_changed' })).map((a) => `${a.before?.status}>${a.after?.status}`);
    expect(statusAudit).toEqual(['new>in_progress', 'in_progress>quote_sent', 'quote_sent>agreed', 'agreed>prepaid', 'prepaid>held']);

    // ---------------------------------------------------------------- Отчёты
    const revenue = await report(ctx, 'revenue', { from: '2026-10-20', to: '2026-10-20', branchId: greenline });
    expect(revenue.totals).toMatchObject({ banquet: money(304_700), total: money(304_700) });
    expect(revenue.counts.banquet).toBe(1);
    const funnel = await report(ctx, 'banquet-funnel', { from: '2026-10-01', to: '2026-10-01', branchId: greenline });
    // В периоде две заявки филиала: наша (проведена, ответ позже SLA) и демо-заявка из сидов (смета сохранена
    // сразу — ответ в пределах SLA). Метрики SLA в Reporting совпадают со статистикой модуля Banquet.
    expect(funnel).toMatchObject({ total: 2, held: 1, heldTotal: money(304_700), answerDue: 2, answeredWithinSla: 1, unansweredOverdue: 0 });
    const slaStats = await ctx.api().get('/api/v1/admin/banquets/sla-stats').query({ from: '2026-10-01', to: '2026-10-01', branchId: greenline }).set('Authorization', owner.auth).expect(200);
    expect(slaStats.body).toMatchObject({ total: 2, answered: 2, answeredWithinSla: funnel.answeredWithinSla, breached: 1 });
    expect(slaStats.body.byManager.find((m: any) => m.managerId === manager.userId)).toMatchObject({ total: 1, breached: 1, answeredWithinSla: 0 });
    expect(funnel.stages.find((s: any) => s.status === 'held')).toMatchObject({ reached: 1, current: 1 });
    const cash = await report(ctx, 'payments', { from: '2026-10-01', to: '2026-10-01', branchId: greenline });
    expect(cash.purposes).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: 'banquet_invoice', received: money(304_700) })]));

    // ---------------------------------------------------------------- Гость: теги и история
    const guest = await customerByPhone(ctx, CONTACT_PHONE);
    expect(guest.customer.tags).toEqual(expect.arrayContaining(['banquet', 'corporate']));
    expect(guest.customer).toMatchObject({ banquetsCount: 1, totalSpent: money(304_700), marketingConsent: true });
    expect(guest.activities.items.map((a: any) => a.type)).toEqual(expect.arrayContaining(['banquet_requested', 'banquet_invoice_issued', 'banquet_held']));
  });
});
