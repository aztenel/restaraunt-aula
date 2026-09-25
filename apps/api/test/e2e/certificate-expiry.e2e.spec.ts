import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createE2eApp, E2eContext, idem, money } from './support/e2e-app';
import { report } from './support/ordering';

/**
 * Дополнительно: сертификаты с истёкшим сроком — Payments (ежедневное истечение, продление с восстановлением
 * остатка) и Reporting (проекция обязательств) показывают одинаковые остатки обязательств.
 */
describe('E2E extra: certificate expiry and reinstatement — liabilities agree across modules', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await ctx.reset();
  });

  async function ownReport(from: string, to: string) {
    return (await ctx.api().get('/api/v1/admin/certificates/report').query({ from, to }).set('Authorization', await ctx.owner()).expect(200)).body;
  }

  it('corporate issue by bank transfer → expiry → reinstatement by extension', async () => {
    const owner = await ctx.owner();
    const products = await ctx.api().get('/api/v1/admin/certificates/products').set('Authorization', owner).expect(200);
    const product = (products.body.items ?? products.body).find((p: any) => p.slug === 'nominal-10000');
    const issued = await ctx
      .api()
      .post('/api/v1/admin/certificates/issue')
      .set('Authorization', owner)
      .send({
        productId: product.id,
        quantity: 2,
        buyer: { name: 'Бухгалтер ТОО «Ромашка»', company: 'ТОО «Ромашка»', phone: '+77013330000', email: 'buh@romashka.kz' },
        deliveryChannel: 'none',
        locale: 'ru',
        documentNumber: 'PP-100',
        paidAt: '2026-10-01T10:00:00+05:00',
        idempotencyKey: idem('corp'),
      })
      .expect(201);
    expect(issued.body.certificates).toHaveLength(2);
    const [a, b] = issued.body.certificates as Array<{ id: string }>;
    await ctx.drain();

    const details = await ctx.api().get(`/api/v1/admin/certificates/${a!.id}`).set('Authorization', owner).expect(200);
    expect(details.body.certificate).toMatchObject({ status: 'active', balance: money(10_000), deliveryChannel: 'none', hasPdf: true });
    // Продажа сертификатов — выручка канала «сертификаты» в день продажи (Reporting из события CertificateIssued).
    const revenue = await report(ctx, 'revenue', { from: '2026-10-01', to: '2026-10-01' });
    expect(revenue.totals.certificate).toEqual(money(20_000));

    // Через 13 месяцев оба сертификата истекают (ежедневная задача Payments → CertificateExpired → Reporting).
    ctx.t.clock.set(new Date('2027-11-02T00:10:00.000Z'));
    await ctx.t.runSchedule('payments.certificates_expire');
    await ctx.drain();
    let own = await ownReport('2027-10-01', '2027-11-02');
    let rep = await report(ctx, 'certificates', { from: '2027-10-01', to: '2027-11-02' });
    expect(own).toMatchObject({ issued: { count: 0 }, expired: { count: 2, amount: money(20_000) }, liability: { active: { count: 0, amount: money(0) } } });
    expect(rep).toMatchObject({ issued: { count: 0 }, expired: { count: 2, balance: money(20_000) }, outstanding: { count: 0, balance: money(0) } });

    // Продление одного сертификата восстанавливает его остаток — обязательства снова 10 000 в обоих отчётах.
    await ctx.api().post(`/api/v1/admin/certificates/${b!.id}/extend`).set('Authorization', owner).send({ validUntil: '2028-06-30', reason: 'Просьба клиента' }).expect(200);
    await ctx.drain();
    own = await ownReport('2027-10-01', '2027-11-02');
    rep = await report(ctx, 'certificates', { from: '2027-10-01', to: '2027-11-02' });
    expect(own.liability.active).toEqual({ count: 1, amount: money(10_000) });
    expect(own.reinstated).toEqual({ count: 1, amount: money(10_000) });
    expect(rep.outstanding).toMatchObject({ count: 1, balance: money(10_000) });
    // «Сгоревший» остаток в Reporting — за вычетом восстановленного продлением.
    expect(rep.expired).toMatchObject({ count: 1, balance: money(10_000) });
    const reinstated = await ctx.api().get(`/api/v1/admin/certificates/${b!.id}`).set('Authorization', owner).expect(200);
    expect(reinstated.body.certificate).toMatchObject({ status: 'active', balance: money(10_000) });
  });
});
