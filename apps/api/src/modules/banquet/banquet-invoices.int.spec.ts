import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StaffRole } from '../identity/public';
import { BanquetEvents } from './public';
import {
  agreedRequest,
  api,
  auditActions,
  BanquetTestContext,
  banquetWorld,
  BanquetWorld,
  createBanquetTestApp,
  outboxErrors,
  publishedEvents,
  resetBanquet,
  succeedPayment,
  tokenFor,
} from './testing/banquet-test-kit';

describe('Banquet: invoices and payments (integration)', () => {
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

  async function company(auth = w.managerAuth, bin = '940140001234') {
    const res = await http()
      .post(api('/admin/banquets/companies'))
      .set('authorization', auth)
      .send({ name: 'ТОО «Ромашка»', bin, legalAddress: 'Астана, ул. Кенесары 1', iban: 'KZ123456789012345678', bik: 'BANKKZKA', kbe: '17' });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it('company invoice: PDF with requisites, corporate tag, bank transfers, overpayment rejected, idempotent registration', async () => {
    // Итог сметы: 100 × 15 000 + 500 000 = 2 000 000 ₸; предоплата 50% = 1 000 000 ₸.
    const r = await agreedRequest(ctx, w);
    expect(r.total).toBe(200_000_000);

    const noCompany = await http().post(api(`/admin/banquets/requests/${r.id}/invoices`)).set('authorization', w.managerAuth).send({ payerType: 'company' });
    expect(noCompany.status).toBe(422);
    expect(noCompany.body.error.code).toBe('banquet_invoice.company_required');

    const companyId = await company();
    const operator = await tokenFor(ctx.t, [{ role: StaffRole.BranchOperator, branchId: w.branchId }]);
    const forbidden = await http().post(api(`/admin/banquets/requests/${r.id}/invoices`)).set('authorization', operator.auth).send({ payerType: 'company', companyId });
    expect(forbidden.status).toBe(403);

    const tooMuch = await http()
      .post(api(`/admin/banquets/requests/${r.id}/invoices`))
      .set('authorization', w.financeAuth)
      .send({ payerType: 'company', companyId, amount: { amount: 200_000_001 } });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.code).toBe('banquet_invoice.exceeds_quote');

    const invoice = await http().post(api(`/admin/banquets/requests/${r.id}/invoices`)).set('authorization', w.financeAuth).send({ payerType: 'company', companyId });
    expect(invoice.status).toBe(201);
    expect(invoice.body).toMatchObject({
      payerType: 'company',
      purpose: 'prepayment',
      amount: { amount: 100_000_000 },
      vat: { amount: 13_793_103 },
      vatRateBp: 1600,
      buyer: { name: 'ТОО «Ромашка»', bin: '940140001234' },
      pdfReady: true,
      paymentId: null,
      dueDate: '2026-10-06',
      requestNumber: r.number,
    });
    const pdfKey = [...ctx.storage.files.keys()].find((k) => k.includes('/invoice-'))!;
    expect(ctx.storage.files.get(pdfKey)!.body.subarray(0, 4).toString()).toBe('%PDF');
    const issued = (await publishedEvents(ctx.t, BanquetEvents.InvoiceIssued))[0]!.payload;
    expect(issued).toMatchObject({ payerType: 'company', company: { name: 'ТОО «Ромашка»', bin: '940140001234' }, dueDate: '2026-10-06' });
    const customer = [...ctx.fakes.customers.customers.values()][0]!;
    expect(customer.tags).toEqual(expect.arrayContaining(['banquet', 'corporate']));
    expect(ctx.fakes.notifier.guest.find((g) => g.template === 'banquet.invoice_issued')).toBeTruthy();

    const token = String(invoice.body.publicUrl).split('/').pop()!;
    const page = await http().get(api(`/public/banquets/invoices/${token}`));
    expect(page.body).toMatchObject({ payerType: 'company', paymentUrl: null, seller: { kbe: '17' } });
    expect(page.body.pdfUrl).toContain('https://files.test/private/');
    const payOnline = await http().post(api(`/public/banquets/invoices/${token}/pay`));
    expect(payOnline.status).toBe(409);
    expect(payOnline.body.error.code).toBe('banquet_invoice.bank_transfer_only');

    // Первое поступление — 40%.
    const first = await http()
      .post(api(`/admin/banquets/invoices/${invoice.body.id}/payments`))
      .set('authorization', w.financeAuth)
      .send({ amount: { amount: 40_000_000 }, paidAt: '2026-10-01T04:00:00Z', documentNumber: 'ПП-101' });
    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);
    expect(first.body.invoice).toMatchObject({ status: 'partially_paid', paid: { amount: 40_000_000 }, remaining: { amount: 60_000_000 } });
    const bankPayment = ctx.fakes.payments.payments.get(first.body.paymentId)!;
    expect(bankPayment).toMatchObject({ purpose: 'banquet_invoice', referenceId: invoice.body.id, method: 'bank_transfer', status: 'succeeded' });

    // Тот же документ повторно — без второго поступления.
    const repeat = await http()
      .post(api(`/admin/banquets/invoices/${invoice.body.id}/payments`))
      .set('authorization', w.financeAuth)
      .send({ amount: { amount: 40_000_000 }, paidAt: '2026-10-01T04:00:00Z', documentNumber: 'ПП-101' });
    expect(repeat.status).toBe(201);
    expect(repeat.body).toMatchObject({ duplicate: true, paymentId: first.body.paymentId });
    expect(repeat.body.invoice.paid.amount).toBe(40_000_000);

    // Переплата — отказ, платёж в модуле Payments не создаётся.
    const paymentsBefore = ctx.fakes.payments.payments.size;
    const over = await http()
      .post(api(`/admin/banquets/invoices/${invoice.body.id}/payments`))
      .set('authorization', w.financeAuth)
      .send({ amount: { amount: 60_000_001 }, paidAt: '2026-10-01T04:00:00Z', documentNumber: 'ПП-102' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('banquet_invoice.overpayment');
    expect(over.body.error.details.remaining).toEqual({ amount: 60_000_000, currency: 'KZT' });
    expect(ctx.fakes.payments.payments.size).toBe(paymentsBefore);

    const future = await http()
      .post(api(`/admin/banquets/invoices/${invoice.body.id}/payments`))
      .set('authorization', w.financeAuth)
      .send({ amount: { amount: 1 }, paidAt: '2026-12-01T04:00:00Z', documentNumber: 'ПП-103' });
    expect(future.status).toBe(422);

    // Остаток — счёт оплачен, предоплата покрыта: agreed -> prepaid.
    const rest = await http()
      .post(api(`/admin/banquets/invoices/${invoice.body.id}/payments`))
      .set('authorization', w.managerAuth)
      .send({ amount: { amount: 60_000_000 }, paidAt: '2026-10-01T05:00:00Z', documentNumber: 'ПП-104' });
    expect(rest.status).toBe(201);
    expect(rest.body.invoice.status).toBe('paid');
    const detail = await http().get(api(`/admin/banquets/requests/${r.id}`)).set('authorization', w.managerAuth);
    expect(detail.body.status).toBe('prepaid');
    expect(detail.body.invoices[0].payments.map((p: any) => p.documentNumber)).toEqual(['ПП-101', 'ПП-104']);
    const recorded = await publishedEvents(ctx.t, BanquetEvents.InvoicePaymentRecorded);
    expect(recorded.map((e) => [e.payload.paidTotal.amount, e.payload.fullyPaid])).toEqual([
      [40_000_000, false],
      [100_000_000, true],
    ]);

    // Событие PaymentSucceeded по банковскому переводу (публикует Payments) — не засчитывается второй раз.
    await succeedPayment(ctx, first.body.paymentId);
    expect(await publishedEvents(ctx.t, BanquetEvents.InvoicePaymentRecorded)).toHaveLength(2);
    expect(await outboxErrors(ctx.t)).toEqual([]);

    // Инвариант и на уровне БД: оплаты не превышают сумму счёта.
    await expect(
      sql`update banquet.invoices set paid_amount = amount_amount + 1 where id = ${invoice.body.id}`.execute(ctx.t.database.rootConnection()),
    ).rejects.toThrow(/invoices_paid_not_exceed/);
    await expect(sql`delete from banquet.invoices where id = ${invoice.body.id}`.execute(ctx.t.database.rootConnection())).rejects.toThrow(
      /Physical delete is forbidden/,
    );

    // Второй счёт — остаток до итога сметы.
    const balance = await http().post(api(`/admin/banquets/requests/${r.id}/invoices`)).set('authorization', w.financeAuth).send({ payerType: 'company' });
    expect(balance.status).toBe(201);
    expect(balance.body).toMatchObject({ purpose: 'payment', amount: { amount: 100_000_000 }, companyId });
    const exhausted = await http().post(api(`/admin/banquets/requests/${r.id}/invoices`)).set('authorization', w.financeAuth).send({ payerType: 'company' });
    expect(exhausted.status).toBe(422);
    expect(exhausted.body.error.code).toBe('banquet_invoice.nothing_to_invoice');

    expect(await auditActions(ctx.t, invoice.body.id)).toEqual([
      'banquet.invoice_issued',
      'banquet.invoice_payment_recorded',
      'banquet.invoice_payment_recorded',
    ]);
  });

  it('invoices are issued only after agreement; unpaid invoice can be cancelled, paid one cannot', async () => {
    const created = await http()
      .post(api('/admin/banquets/requests'))
      .set('authorization', w.managerAuth)
      .send({ eventDate: '2026-11-14', eventType: 'birthday', guests: 30, branchId: w.branchId, contact: { name: 'Нурлан', phone: '+77015554433' } });
    const early = await http().post(api(`/admin/banquets/requests/${created.body.id}/invoices`)).set('authorization', w.managerAuth).send({ payerType: 'individual' });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('banquet_invoice.request_not_agreed');

    const r = await agreedRequest(ctx, w);
    const invoice = await http().post(api(`/admin/banquets/requests/${r.id}/invoices`)).set('authorization', w.managerAuth).send({ payerType: 'individual' });
    const cancelled = await http()
      .post(api(`/admin/banquets/invoices/${invoice.body.id}/cancel`))
      .set('authorization', w.managerAuth)
      .send({ reason: 'Клиент попросил другую сумму' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelReason: 'Клиент попросил другую сумму' });
    expect(ctx.fakes.payments.payments.get(invoice.body.paymentId)!.status).toBe('cancelled');

    // Поздняя оплата отменённого счёта не засчитывается и автоматически возвращается.
    await succeedPayment(ctx, invoice.body.paymentId);
    expect(ctx.fakes.payments.refunds).toHaveLength(1);
    expect(ctx.fakes.payments.refunds[0]).toMatchObject({ paymentId: invoice.body.paymentId });
    const detail = await http().get(api(`/admin/banquets/requests/${r.id}`)).set('authorization', w.managerAuth);
    expect(detail.body.status).toBe('agreed');
    expect(detail.body.invoices[0].paid.amount).toBe(0);
    expect(detail.body.timeline.map((a: any) => a.kind)).toContain('refund_requested');

    const second = await http()
      .post(api(`/admin/banquets/requests/${r.id}/invoices`))
      .set('authorization', w.managerAuth)
      .send({ payerType: 'individual', amount: { amount: 50_000_000 }, dueDate: '2026-10-03' });
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ amount: { amount: 50_000_000 }, purpose: 'prepayment', dueDate: '2026-10-03' });
    await succeedPayment(ctx, second.body.paymentId);
    const paidCancel = await http().post(api(`/admin/banquets/invoices/${second.body.id}/cancel`)).set('authorization', w.managerAuth).send({});
    expect(paidCancel.status).toBe(409);
    expect(paidCancel.body.error.code).toBe('banquet_invoice.has_payments');
    // 500 000 из 1 000 000 предоплаты — ещё agreed; менеджер снижает предоплату — заявка становится prepaid.
    const stillAgreed = await http().get(api(`/admin/banquets/requests/${r.id}`)).set('authorization', w.managerAuth);
    expect(stillAgreed.body.status).toBe('agreed');
    expect(stillAgreed.body.allowedTransitions).not.toContain('prepaid');
    const manualPrepaid = await http().post(api(`/admin/banquets/requests/${r.id}/transition`)).set('authorization', w.managerAuth).send({ to: 'prepaid' });
    expect(manualPrepaid.status).toBe(422);
    expect(manualPrepaid.body.error.code).toBe('banquet.prepayment_not_received');
    const lowered = await http()
      .put(api(`/admin/banquets/requests/${r.id}/prepayment`))
      .set('authorization', w.managerAuth)
      .send({ amount: { amount: 50_000_000 } });
    expect(lowered.status).toBe(200);
    expect(lowered.body.status).toBe('prepaid');
    expect(lowered.body.prepayment).toMatchObject({ required: { amount: 50_000_000 }, covered: true, isCustom: true });

    // Просроченные счета: срок прошёл, счёт не оплачен.
    const third = await http()
      .post(api(`/admin/banquets/requests/${r.id}/invoices`))
      .set('authorization', w.managerAuth)
      .send({ payerType: 'individual', amount: { amount: 10_000_000 }, dueDate: '2026-10-02' });
    ctx.t.clock.set(new Date('2026-10-05T06:00:00Z'));
    const overdue = await http().get(api('/admin/banquets/invoices')).query({ overdue: 'true' }).set('authorization', w.financeAuth);
    expect(overdue.status).toBe(200);
    expect(overdue.body.items.map((i: any) => i.id)).toEqual([third.body.id]);
    expect(overdue.body.items[0]).toMatchObject({ overdue: true, requestNumber: r.number });
  });

  it('refunds require payments.refund (finance/owner); public payment link is renewed after expiry', async () => {
    const r = await agreedRequest(ctx, w);
    const invoice = await http().post(api(`/admin/banquets/requests/${r.id}/invoices`)).set('authorization', w.managerAuth).send({ payerType: 'individual' });
    const token = String(invoice.body.publicUrl).split('/').pop()!;

    // Ссылка истекла (платёж отменён модулем Payments) — витрина запрашивает новую.
    ctx.fakes.payments.payments.get(invoice.body.paymentId)!.status = 'cancelled';
    const renewed = await http().post(api(`/public/banquets/invoices/${token}/pay`));
    expect(renewed.status).toBe(200);
    expect(renewed.body.paymentUrl).toMatch(/^https:\/\/pay\.test\/banquet-invoice:.+:1$/);
    const current = await http().get(api(`/admin/banquets/invoices/${invoice.body.id}`)).set('authorization', w.managerAuth);
    expect(current.body.paymentId).not.toBe(invoice.body.paymentId);
    await succeedPayment(ctx, current.body.paymentId);

    const refundBody = { paymentId: current.body.paymentId, reason: 'Отмена банкета', idempotencyKey: 'refund-attempt-0001' };
    const byManager = await http().post(api(`/admin/banquets/requests/${r.id}/refunds`)).set('authorization', w.managerAuth).send(refundBody);
    expect(byManager.status).toBe(403);
    const byFinance = await http().post(api(`/admin/banquets/requests/${r.id}/refunds`)).set('authorization', w.financeAuth).send(refundBody);
    expect(byFinance.status).toBe(201);
    expect(byFinance.body).toMatchObject({ paymentId: current.body.paymentId, status: 'pending', amount: { amount: 100_000_000 } });
    const foreign = await http()
      .post(api(`/admin/banquets/requests/${r.id}/refunds`))
      .set('authorization', w.ownerAuth)
      .send({ ...refundBody, paymentId: '01926f00-0000-7000-8000-000000000000' });
    expect(foreign.status).toBe(404);
    expect(await auditActions(ctx.t, invoice.body.id)).toContain('banquet.refund_requested');
  });

  it('admin invoice: payment link, resend / regenerate, refundable amount per payment and refunds with status', async () => {
    const r = await agreedRequest(ctx, w);
    const invoice = await http().post(api(`/admin/banquets/requests/${r.id}/invoices`)).set('authorization', w.managerAuth).send({ payerType: 'individual' });
    expect(invoice.status).toBe(201);
    const first = ctx.fakes.payments.payments.get(invoice.body.paymentId)!;
    expect(invoice.body).toMatchObject({ paymentUrl: first.paymentUrl, paymentStatus: 'created', canResendPaymentLink: true, refunds: [] });

    // Повторная отправка: действующая ссылка та же, гостю — уведомление; аудит.
    ctx.fakes.notifier.clear();
    const resent = await http().post(api(`/admin/banquets/invoices/${invoice.body.id}/payment-link`)).set('authorization', w.managerAuth).send({});
    expect(resent.status).toBe(200);
    expect(resent.body).toMatchObject({ paymentId: first.id, paymentUrl: first.paymentUrl });
    expect(ctx.fakes.notifier.guest.map((g) => g.template)).toEqual(['banquet.invoice_issued']);
    expect(ctx.fakes.notifier.guest[0]!.params).toMatchObject({ invoiceNumber: invoice.body.number, paymentUrl: invoice.body.publicUrl });
    // Перевыпуск: прежний неоплаченный платёж отменяется, новая ссылка.
    const regenerated = await http()
      .post(api(`/admin/banquets/invoices/${invoice.body.id}/payment-link`))
      .set('authorization', w.managerAuth)
      .send({ regenerate: true });
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.paymentId).not.toBe(first.id);
    expect(regenerated.body.paymentUrl).toMatch(/^https:\/\/pay\.test\/banquet-invoice:.+:1$/);
    expect(first.status).toBe('cancelled');
    expect(await auditActions(ctx.t, invoice.body.id)).toEqual(expect.arrayContaining(['banquet.invoice_payment_link_sent']));
    // Права: banquets.invoice.
    const branchManager = await tokenFor(ctx.t, [{ role: StaffRole.BranchManager, branchId: w.branchId }]);
    expect((await http().post(api(`/admin/banquets/invoices/${invoice.body.id}/payment-link`)).set('authorization', branchManager.auth).send({})).status).toBe(403);

    // Оплата: ссылки больше нет, повторная отправка невозможна; возвраты с остатком к возврату.
    await succeedPayment(ctx, regenerated.body.paymentId);
    let paid = (await http().get(api(`/admin/banquets/invoices/${invoice.body.id}`)).set('authorization', w.financeAuth)).body;
    expect(paid).toMatchObject({ status: 'paid', paymentUrl: null, paymentStatus: 'succeeded', canResendPaymentLink: false });
    expect(paid.payments).toEqual([expect.objectContaining({ paymentId: regenerated.body.paymentId, refundable: { amount: 100_000_000, currency: 'KZT' } })]);
    const again = await http().post(api(`/admin/banquets/invoices/${invoice.body.id}/payment-link`)).set('authorization', w.managerAuth).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('banquet_invoice.not_payable');

    const refund = await http()
      .post(api(`/admin/banquets/requests/${r.id}/refunds`))
      .set('authorization', w.financeAuth)
      .send({ paymentId: regenerated.body.paymentId, amount: { amount: 30_000_000 }, reason: 'Уменьшили число гостей', idempotencyKey: 'refund-partial-0001' });
    expect(refund.status).toBe(201);
    paid = (await http().get(api(`/admin/banquets/invoices/${invoice.body.id}`)).set('authorization', w.financeAuth)).body;
    expect(paid.payments[0].refundable).toEqual({ amount: 70_000_000, currency: 'KZT' });
    expect(paid.refunds).toEqual([
      expect.objectContaining({
        refundId: refund.body.id,
        paymentId: regenerated.body.paymentId,
        amount: { amount: 30_000_000, currency: 'KZT' },
        status: 'pending',
        reason: expect.stringContaining('Уменьшили число гостей'),
      }),
    ]);
    // Неудачный возврат не уменьшает остаток к возврату.
    ctx.fakes.payments.refunds[0]!.status = 'failed';
    const detail = (await http().get(api(`/admin/banquets/requests/${r.id}`)).set('authorization', w.financeAuth)).body;
    expect(detail.invoices[0].payments[0].refundable.amount).toBe(100_000_000);
    expect(detail.invoices[0].refunds[0].status).toBe('failed');
    const list = (await http().get(api('/admin/banquets/invoices')).set('authorization', w.financeAuth)).body;
    expect(list.items[0]).toMatchObject({ id: invoice.body.id, refunds: [expect.objectContaining({ status: 'failed' })] });
  });

  it('company invoices have no payment link to resend', async () => {
    const r = await agreedRequest(ctx, w);
    const companyId = await company();
    const invoice = await http().post(api(`/admin/banquets/requests/${r.id}/invoices`)).set('authorization', w.financeAuth).send({ payerType: 'company', companyId });
    expect(invoice.status).toBe(201);
    expect(invoice.body).toMatchObject({ paymentUrl: null, paymentStatus: null, canResendPaymentLink: false });
    const denied = await http().post(api(`/admin/banquets/invoices/${invoice.body.id}/payment-link`)).set('authorization', w.financeAuth).send({});
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe('banquet_invoice.bank_transfer_only');
  });

  it('cancellation releases the venue and cancels unpaid invoices; a reason is required', async () => {
    const r = await agreedRequest(ctx, w);
    const venue = ctx.fakes.venues.addVenue(w.branchId, { capacityMax: 150 });
    const set = await http()
      .put(api(`/admin/banquets/requests/${r.id}/venue`))
      .set('authorization', w.managerAuth)
      .send({ venueId: venue.id, startTime: '17:00', endTime: '23:00' });
    expect(set.status).toBe(200);
    expect(ctx.fakes.venues.holds.size).toBe(1);
    const invoice = await http().post(api(`/admin/banquets/requests/${r.id}/invoices`)).set('authorization', w.managerAuth).send({ payerType: 'individual' });

    const noReason = await http().post(api(`/admin/banquets/requests/${r.id}/transition`)).set('authorization', w.managerAuth).send({ to: 'cancelled' });
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.code).toBe('banquet.cancel_reason_required');
    const cancelled = await http()
      .post(api(`/admin/banquets/requests/${r.id}/transition`))
      .set('authorization', w.managerAuth)
      .send({ to: 'cancelled', reason: 'Перенесли на весну' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelReason: 'Перенесли на весну', venue: null, allowedTransitions: [] });
    expect(ctx.fakes.venues.holds.size).toBe(0);
    expect(cancelled.body.invoices[0].status).toBe('cancelled');
    expect(ctx.fakes.payments.payments.get(invoice.body.paymentId)!.status).toBe('cancelled');
    const event = (await publishedEvents(ctx.t, BanquetEvents.StatusChanged)).at(-1)!.payload;
    expect(event).toMatchObject({ from: 'agreed', to: 'cancelled', reason: 'Перенесли на весну', quoteTotal: { amount: r.total } });
  });
});
