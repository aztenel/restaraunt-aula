import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StaffRole } from '../identity/public';
import { BanquetEvents } from './public';
import {
  api,
  auditActions,
  BanquetTestContext,
  banquetWorld,
  BanquetWorld,
  createBanquetTestApp,
  outboxErrors,
  publicRequestBody,
  publishedEvents,
  resetBanquet,
  succeedPayment,
  tokenFor,
} from './testing/banquet-test-kit';

describe('Banquet: full flow (integration)', () => {
  let ctx: BanquetTestContext;
  let w: BanquetWorld;

  beforeAll(async () => {
    ctx = await createBanquetTestApp();
  });
  afterAll(async () => ctx.t.close());
  beforeEach(async () => {
    await resetBanquet(ctx);
    w = await banquetWorld(ctx);
  });

  const http = () => ctx.t.http();

  it('public request -> auto-assign -> quote v1/v2 -> send -> accept -> invoice -> payment -> prepaid -> held -> act -> ESF XML', async () => {
    // Второй менеджер уже ведёт открытую заявку — новая достанется менее загруженному (w.managerId).
    const busy = await tokenFor(ctx.t, [{ role: StaffRole.BanquetManager }], 'Занятый менеджер');
    const prior = await http()
      .post(api('/admin/banquets/requests'))
      .set('authorization', w.ownerAuth)
      .send({ ...publicRequestBody(w.branchId), consent: undefined, managerId: busy.userId, contact: { name: 'Ерлан', phone: '+77019998877' } });
    expect(prior.status).toBe(201);
    expect(prior.body.managerId).toBe(busy.userId);
    expect(prior.body.source).toBe('admin');
    ctx.fakes.notifier.clear();

    // --- заявка с витрины
    const noConsent = await http().post(api('/public/banquets/requests')).send(publicRequestBody(w.branchId, { consent: { personalData: false } }));
    expect(noConsent.status).toBe(422);
    expect(noConsent.body.error.code).toBe('consent.required');

    const created = await http().post(api('/public/banquets/requests')).send(publicRequestBody(w.branchId));
    expect(created.status).toBe(201);
    expect(created.body.number).toMatch(/^GL-B-2026-\d{6}$/);
    expect(created.body.status).toBe('new');
    expect(created.body.managerName).toBe('Динара Менеджер');

    const customer = [...ctx.fakes.customers.customers.values()].find((c) => c.phone === '+77011234567')!;
    expect(customer.tags).toContain('banquet');
    expect(ctx.fakes.customers.consents.map((c) => c.kind).sort()).toEqual(['marketing', 'personal_data']);
    expect(ctx.fakes.notifier.guest.find((g) => g.template === 'banquet.request_received')?.params).toMatchObject({
      number: created.body.number,
      managerName: 'Динара Менеджер',
    });
    const staffNew = ctx.fakes.notifier.staff.find((s) => s.template === 'staff.banquet_new')!;
    expect(staffNew.audience).toMatchObject({ userIds: [w.managerId] });
    expect(ctx.fakes.adminFeed.events.find((e) => e.kind === 'created' && e.stream === 'banquets')).toMatchObject({ sound: true });

    const createdEvents = await publishedEvents(ctx.t, BanquetEvents.RequestCreated);
    const createdEvent = createdEvents.find((e) => e.payload.number === created.body.number)!.payload;
    expect(createdEvent).toMatchObject({ managerId: w.managerId, source: 'web', guests: 100, eventType: 'wedding', isOffsite: false });
    expect(createdEvent.contact).toEqual({ customerId: customer.id, name: 'Айгерим', phone: '+77011234567', email: 'aigerim@mail.kz' });
    expect(createdEvent.budget).toEqual({ amount: 300_000_000, currency: 'KZT' });

    const list = await http().get(api('/admin/banquets/requests')).query({ q: created.body.number }).set('authorization', w.managerAuth);
    const id = list.body.items[0].id as string;
    expect(list.body.items[0]).toMatchObject({ status: 'new', managerId: w.managerId, slaBreached: false });

    // --- в работу (первый ответ менеджера)
    ctx.t.clock.advance(5 * 60_000);
    const inWork = await http().post(api(`/admin/banquets/requests/${id}/transition`)).set('authorization', w.managerAuth).send({ to: 'in_progress' });
    expect(inWork.status).toBe(200);
    expect(inWork.body.status).toBe('in_progress');
    expect(inWork.body.firstResponseAt).toBe(ctx.t.clock.now().toISOString());
    expect(inWork.body.allowedTransitions).toEqual(['cancelled']);

    // --- смета v1: блюдо из меню филиала (снимок цены) + произвольная позиция
    const plov = ctx.fakes.menu.add({ name: 'Плов', price: 350_000 });
    const v1 = await http()
      .post(api(`/admin/banquets/requests/${id}/quotes`))
      .set('authorization', w.managerAuth)
      .send({
        lines: [
          { kind: 'menu', dishId: plov.dishId, quantity: 100, discount: { type: 'percent', bp: 1000 } },
          { kind: 'hall_rent', title: { ru: 'Аренда зала', kk: 'Зал жалға алу' }, unit: 'усл.', unitPrice: { amount: 20_000_000 }, quantity: 1 },
        ],
        serviceChargeBp: 1000,
      });
    expect(v1.status).toBe(201);
    expect(v1.body.version).toBe(1);
    expect(v1.body.lines[0]).toMatchObject({ kind: 'menu', title: { ru: 'Плов' }, unitPrice: { amount: 350_000 }, unit: 'порц.' });
    // 100 × 3 500 = 350 000 − 10% = 315 000; + зал 200 000 = 515 000; + 10% = 566 500; НДС 16% включён.
    expect(v1.body.totals.total.amount).toBe(56_650_000);
    expect(v1.body.totals.vat.amount).toBe(7_813_793);
    expect(v1.body.totals.perGuest.amount).toBe(566_500);
    expect(v1.body.vatPayer).toBe(true);

    // Меню подорожало — в следующей версии у блюда остаётся цена на момент добавления.
    ctx.fakes.menu.dishes.get(plov.dishId)!.price = 400_000;
    const v2 = await http()
      .post(api(`/admin/banquets/requests/${id}/quotes`))
      .set('authorization', w.managerAuth)
      .send({
        lines: [
          { kind: 'menu', dishId: plov.dishId, quantity: 120 },
          { kind: 'hall_rent', title: { ru: 'Аренда зала' }, unit: 'усл.', unitPrice: { amount: 20_000_000 }, quantity: 1 },
          { kind: 'musicians', title: { ru: 'Домбрист' }, unit: 'час', unitPrice: { amount: 3_000_000 }, quantity: 2 },
        ],
        discount: { type: 'amount', amount: { amount: 2_000_000 } },
      });
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    expect(v2.body.lines[0].unitPrice.amount).toBe(350_000);
    // 120 × 3 500 = 420 000 + 200 000 + 60 000 = 680 000 − 20 000 = 660 000.
    expect(v2.body.totals.total.amount).toBe(66_000_000);

    const versions = await http().get(api(`/admin/banquets/requests/${id}/quotes`)).set('authorization', w.managerAuth);
    expect(versions.body.map((v: any) => v.version)).toEqual([2, 1]);
    const v1Again = await http().get(api(`/admin/banquets/quotes/${v1.body.id}`)).set('authorization', w.managerAuth);
    expect(v1Again.body.totals.total.amount).toBe(56_650_000);
    expect(v1Again.body.isLatest).toBe(false);

    const pdf = await http().get(api(`/admin/banquets/quotes/${v2.body.id}/pdf`)).set('authorization', w.managerAuth);
    expect(pdf.status).toBe(200);
    expect(pdf.body.url).toContain('https://files.test/private/banquet/');
    const pdfFile = [...ctx.storage.files.entries()].find(([k]) => k.includes('/quote-'))!;
    expect(pdfFile[1].body.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdfFile[1].visibility).toBe('private');

    // --- отправка v1 невозможна (не последняя), v2 — отправлена
    const oldSend = await http().post(api(`/admin/banquets/quotes/${v1.body.id}/send`)).set('authorization', w.managerAuth);
    expect(oldSend.status).toBe(409);
    expect(oldSend.body.error.code).toBe('banquet_quote.outdated');
    const sent = await http().post(api(`/admin/banquets/quotes/${v2.body.id}/send`)).set('authorization', w.managerAuth);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('quote_sent');
    const token = String(sent.body.publicQuoteUrl).split('/').pop()!;
    const quoteSent = ctx.fakes.notifier.guest.find((g) => g.template === 'banquet.quote_sent')!;
    expect((quoteSent.params as any).quoteUrl).toContain(token);
    expect((quoteSent.params as any).total).toBe('660 000 ₸');

    // --- страница сметы для клиента и согласование
    const page = await http().get(api(`/public/banquets/quotes/${token}`)).query({ locale: 'kk' });
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ version: 2, canAccept: true, accepted: false, status: 'quote_sent', eventTypeLabel: 'Үйлену тойы' });
    expect(page.body.lines).toHaveLength(3);
    expect(page.body.total.amount).toBe(66_000_000);
    expect(page.body.pdfUrl).toContain('https://files.test/private/');

    const outdated = await http().post(api(`/public/banquets/quotes/${token}/accept`)).send({ version: 1 });
    expect(outdated.status).toBe(409);
    expect(outdated.body.error.code).toBe('banquet_quote.outdated');
    const accepted = await http().post(api(`/public/banquets/quotes/${token}/accept`)).send({ version: 2 });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ status: 'agreed', version: 2, prepayment: { amount: 33_000_000, currency: 'KZT' } });
    const again = await http().post(api(`/public/banquets/quotes/${token}/accept`)).send({ version: 2 });
    expect(again.status).toBe(200);

    // --- счёт физлицу: онлайн-оплата, referenceId платежа — id счёта
    const invoice = await http().post(api(`/admin/banquets/requests/${id}/invoices`)).set('authorization', w.managerAuth).send({ payerType: 'individual' });
    expect(invoice.status).toBe(201);
    expect(invoice.body).toMatchObject({ payerType: 'individual', purpose: 'prepayment', status: 'issued', amount: { amount: 33_000_000 } });
    expect(invoice.body.number).toMatch(/^GL-S-2026-\d{6}$/);
    const payment = ctx.fakes.payments.payments.get(invoice.body.paymentId)!;
    expect(payment).toMatchObject({ purpose: 'banquet_invoice', referenceId: invoice.body.id, method: 'online' });
    expect(payment.amount.amount).toBe(33_000_000);
    const issued = (await publishedEvents(ctx.t, BanquetEvents.InvoiceIssued))[0]!.payload;
    expect(issued).toMatchObject({ invoiceId: invoice.body.id, requestId: id, payerType: 'individual', company: null, amount: { amount: 33_000_000 } });
    expect(ctx.fakes.notifier.guest.find((g) => g.template === 'banquet.invoice_issued')?.params).toMatchObject({ invoiceNumber: invoice.body.number });

    const invoiceToken = String(invoice.body.publicUrl).split('/').pop()!;
    const invoicePage = await http().get(api(`/public/banquets/invoices/${invoiceToken}`));
    expect(invoicePage.status).toBe(200);
    expect(invoicePage.body).toMatchObject({ status: 'issued', paymentUrl: payment.paymentUrl, remaining: { amount: 33_000_000 } });

    // --- онлайн-оплата прошла -> счёт оплачен -> предоплата получена
    await succeedPayment(ctx, payment.id);
    expect(await outboxErrors(ctx.t)).toEqual([]);
    const afterPay = await http().get(api(`/admin/banquets/requests/${id}`)).set('authorization', w.managerAuth);
    expect(afterPay.body.status).toBe('prepaid');
    expect(afterPay.body.invoices[0]).toMatchObject({ status: 'paid', paid: { amount: 33_000_000 } });
    expect(afterPay.body.prepayment).toMatchObject({ covered: true, paid: { amount: 33_000_000 } });
    expect(afterPay.body.balance.remaining.amount).toBe(33_000_000);
    const paymentEvents = await publishedEvents(ctx.t, BanquetEvents.InvoicePaymentRecorded);
    expect(paymentEvents).toHaveLength(1);
    expect(paymentEvents[0]!.payload).toMatchObject({ paymentId: payment.id, fullyPaid: true, remaining: { amount: 0 } });
    expect(ctx.fakes.notifier.guest.find((g) => g.template === 'banquet.payment_received')?.params).toMatchObject({
      amount: '330 000 ₸',
      remaining: '330 000 ₸',
    });
    // Повторное событие того же платежа ничего не меняет.
    await succeedPayment(ctx, payment.id);
    expect(await publishedEvents(ctx.t, BanquetEvents.InvoicePaymentRecorded)).toHaveLength(1);

    // --- проведено: не раньше даты мероприятия; StatusChanged с итогом сметы (выручка)
    const early = await http().post(api(`/admin/banquets/requests/${id}/transition`)).set('authorization', w.managerAuth).send({ to: 'held' });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('banquet.event_not_yet_held');
    ctx.t.clock.set(new Date('2026-11-14T20:00:00Z'));
    const held = await http().post(api(`/admin/banquets/requests/${id}/transition`)).set('authorization', w.managerAuth).send({ to: 'held' });
    expect(held.status).toBe(200);
    expect(held.body.status).toBe('held');
    expect(held.body).toMatchObject({ canIssueAct: true, canEditQuote: false, canSendLatestQuote: false, canIssueInvoice: true });
    const statusEvents = (await publishedEvents(ctx.t, BanquetEvents.StatusChanged)).filter((e) => e.payload.requestId === id);
    expect(statusEvents.map((e) => `${e.payload.from}->${e.payload.to}`)).toEqual([
      'new->in_progress',
      'in_progress->quote_sent',
      'quote_sent->agreed',
      'agreed->prepaid',
      'prepaid->held',
    ]);
    expect(statusEvents.at(-1)!.payload).toMatchObject({ quoteTotal: { amount: 66_000_000, currency: 'KZT' }, managerId: w.managerId });
    expect(statusEvents.at(-1)!.payload.contact.customerId).toBe(customer.id);

    // --- заказчик — компания: акт, ЭСФ (черновик XML для бухгалтера)
    const company = await http()
      .post(api('/admin/banquets/companies'))
      .set('authorization', w.managerAuth)
      .send({ name: 'ТОО «Ромашка»', bin: '940140001234', legalAddress: 'Астана, ул. Кенесары 1', directorName: 'Петров П.П.', directorPosition: 'Директор', actingBasis: 'Устава' });
    expect(company.status).toBe(201);
    const closedUpdate = await http().patch(api(`/admin/banquets/requests/${id}`)).set('authorization', w.managerAuth).send({ companyId: company.body.id });
    expect(closedUpdate.status).toBe(409);
    expect(closedUpdate.body.error.code).toBe('banquet.request_closed');

    const act = await http().post(api(`/admin/banquets/requests/${id}/act`)).set('authorization', w.managerAuth);
    expect(act.status).toBe(201);
    expect(act.body).toMatchObject({ payerType: 'individual', amount: { amount: 66_000_000 }, vat: { amount: 9_103_448 } });
    expect(act.body.esf.status).toBe('not_required');
    expect(act.body.esfRetryable).toBe(false);
    expect((await http().get(api(`/admin/banquets/requests/${id}`)).set('authorization', w.managerAuth)).body.canIssueAct).toBe(false);
    const duplicateAct = await http().post(api(`/admin/banquets/requests/${id}/act`)).set('authorization', w.managerAuth);
    expect(duplicateAct.status).toBe(409);
    const actEvent = (await publishedEvents(ctx.t, BanquetEvents.ActIssued))[0]!.payload;
    expect(actEvent).toMatchObject({ actId: act.body.id, requestId: id, amount: { amount: 66_000_000 }, vatAmount: { amount: 9_103_448 }, company: null });

    const audit = await auditActions(ctx.t, id);
    expect(audit[0]).toBe('banquet.request_created');
    expect(audit.filter((a) => a === 'banquet.status_changed')).toHaveLength(5);
  });

  it('corporate client: act for a company of a VAT-paying seller produces an ESF XML draft (manual mode)', async () => {
    const company = await http()
      .post(api('/admin/banquets/companies'))
      .set('authorization', w.managerAuth)
      .send({
        name: 'ТОО «Ромашка»',
        bin: '940140001234',
        legalAddress: 'Астана, ул. Кенесары 1',
        bankName: 'АО «Банк»',
        iban: 'KZ123456789012345678',
        bik: 'BANKKZKA',
        kbe: '17',
        directorName: 'Петров П.П.',
      });
    const created = await http()
      .post(api('/admin/banquets/requests'))
      .set('authorization', w.managerAuth)
      .send({ ...publicRequestBody(w.branchId), consent: undefined, eventType: 'corporate', companyId: company.body.id });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const quote = await http()
      .post(api(`/admin/banquets/requests/${id}/quotes`))
      .set('authorization', w.managerAuth)
      .send({ lines: [{ kind: 'other', title: { ru: 'Корпоративный ужин' }, unit: 'чел.', unitPrice: { amount: 1_160_000 }, quantity: 100 }] });
    await http().post(api(`/admin/banquets/quotes/${quote.body.id}/send`)).set('authorization', w.managerAuth);
    const agreed = await http().post(api(`/admin/banquets/requests/${id}/transition`)).set('authorization', w.managerAuth).send({ to: 'agreed' });
    expect(agreed.status).toBe(200);
    expect(agreed.body.status).toBe('agreed');
    expect(agreed.body.prepayment.required.amount).toBe(58_000_000);

    const contract = await http().post(api(`/admin/banquets/requests/${id}/contract`)).set('authorization', w.managerAuth).send({});
    expect(contract.status).toBe(404);
    expect(contract.body.error.code).toBe('banquet_contract_template.not_found');

    const invoice = await http().post(api(`/admin/banquets/requests/${id}/invoices`)).set('authorization', w.financeAuth).send({ payerType: 'company' });
    expect(invoice.status).toBe(201);
    const transfer = await http()
      .post(api(`/admin/banquets/invoices/${invoice.body.id}/payments`))
      .set('authorization', w.financeAuth)
      .send({ amount: { amount: 58_000_000 }, paidAt: '2026-10-01T05:00:00Z', documentNumber: '771' });
    expect(transfer.status).toBe(201);
    await ctx.t.drain();
    ctx.t.clock.set(new Date('2026-11-15T06:00:00Z'));
    expect((await http().post(api(`/admin/banquets/requests/${id}/transition`)).set('authorization', w.managerAuth).send({ to: 'held' })).status).toBe(200);

    const act = await http().post(api(`/admin/banquets/requests/${id}/act`)).set('authorization', w.financeAuth);
    expect(act.status).toBe(201);
    expect(act.body.number).toMatch(/^GL-A-2026-\d{6}$/);
    expect(act.body.esf.status).toBe('pending');
    expect(act.body.buyer).toEqual({ name: 'ТОО «Ромашка»', bin: '940140001234' });
    await ctx.t.drain();
    expect(await outboxErrors(ctx.t)).toEqual([]);

    const detail = await http().get(api(`/admin/banquets/requests/${id}`)).set('authorization', w.managerAuth);
    expect(detail.body.act.esf).toMatchObject({ status: 'draft_ready', provider: 'manual', error: null });
    expect(detail.body.act.esfRetryable).toBe(true);
    expect(detail.body.documents.map((d: any) => d.kind).sort()).toEqual(['act', 'esf_xml', 'invoice']);
    const esfDoc = detail.body.documents.find((d: any) => d.kind === 'esf_xml');
    const link = await http().get(api(`/admin/banquets/documents/${esfDoc.id}/link`)).set('authorization', w.financeAuth);
    expect(link.status).toBe(200);
    const xmlFile = [...ctx.storage.files.entries()].find(([k]) => k.includes('/esf_xml-'))!;
    const xml = xmlFile[1].body.toString('utf8');
    expect(xml).toContain('<v2:invoice');
    expect(xml).toContain('<invoiceType>ORDINARY_INVOICE</invoiceType>');
    expect(xml).toContain('<tin>940140001234</tin>');
    expect(xml).toContain('<totalPriceWithTax>1160000.00</totalPriceWithTax>');
    expect(xml).toContain('<totalNdsAmount>160000.00</totalNdsAmount>');
    expect(xml).toContain('<turnoverDate>14.11.2026</turnoverDate>');
    expect(xml).toContain('<ndsRate>16</ndsRate>');
    expect(xmlFile[1].contentType).toBe('application/xml');

    const retry = await http().post(api(`/admin/banquets/acts/${act.body.id}/esf/retry`)).set('authorization', w.financeAuth);
    expect(retry.status).toBe(201);
    expect(retry.body.esf.status).toBe('pending');
    expect(retry.body.esfRetryable).toBe(false);
  });
});
