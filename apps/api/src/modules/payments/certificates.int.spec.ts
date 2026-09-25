import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch, tokenFor } from '../../../test/support/fixtures';
import { RateLimiter } from '../../shared/infrastructure/rate-limit/rate-limiter';
import { FileStorage } from '../../shared/infrastructure/storage/file-storage';
import { Money } from '../../shared/kernel/money';
import { CertificateCheckRepository } from './infrastructure/certificate-check.repository';
import { PaymentsEvents, PaymentsService } from './public';
import {
  auditActions,
  auditEntries,
  createCertificateProduct,
  createPaymentsTestApp,
  issueCertificate,
  PaymentsTestContext,
  publishedEvents,
  resetPayments,
  sandboxDecision,
} from './testing/payments-test-kit';

describe('Gift certificates (integration)', () => {
  let ctx: PaymentsTestContext;
  let branchA: string;
  let branchB: string;

  beforeAll(async () => {
    ctx = await createPaymentsTestApp();
  });
  afterAll(async () => ctx.t.close());
  beforeEach(async () => {
    await resetPayments(ctx);
    branchA = await createBranch(ctx.t);
    branchB = await createBranch(ctx.t);
  });

  const http = () => ctx.t.http();

  function purchaseBody(productId: string, overrides: Record<string, unknown> = {}) {
    return {
      productId,
      quantity: 2,
      buyer: { name: 'Айгерим', phone: '8 701 555 44 33', email: 'aigerim@example.kz' },
      recipient: { name: 'Данияр', email: 'daniyar@example.kz' },
      message: 'С днём рождения!',
      deliveryChannel: 'email',
      consent: { personalData: true },
      locale: 'ru',
      idempotencyKey: `purchase-${Math.random()}`,
      ...overrides,
    };
  }

  describe('products', () => {
    it('admin CRUD requires certificates.manage; storefront lists active products translated', async () => {
      const owner = await tokenFor(ctx.t, [{ role: 'owner' }]);
      const content = await tokenFor(ctx.t, [{ role: 'content_manager' }]);
      const finance = await tokenFor(ctx.t, [{ role: 'finance' }]);
      const body = {
        slug: 'nominal-10000',
        kind: 'amount',
        name: { ru: 'Сертификат на 10 000 ₸', kk: '10 000 ₸ сертификаты' },
        nominal: { amount: 1_000_000 },
        price: { amount: 1_000_000 },
        design: { color: '#123456', theme: 'festive' },
      };
      expect((await http().post('/api/v1/admin/certificates/products').set('authorization', content.auth).send(body)).status).toBe(403);
      expect((await http().post('/api/v1/admin/certificates/products').set('authorization', finance.auth).send(body)).status).toBe(403);
      const created = await http().post('/api/v1/admin/certificates/products').set('authorization', owner.auth).send(body);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ slug: 'nominal-10000', validityMonths: 12, isActive: true, design: { color: '#123456' }, missingLocales: [] });
      expect((await http().post('/api/v1/admin/certificates/products').set('authorization', owner.auth).send(body)).status).toBe(409);
      const set = await http()
        .post('/api/v1/admin/certificates/products')
        .set('authorization', owner.auth)
        .send({ ...body, slug: 'set-dinner', kind: 'set' });
      expect(set.status).toBe(422);
      expect(set.body.error.code).toBe('translatable.required');

      const updated = await http()
        .put(`/api/v1/admin/certificates/products/${created.body.id}`)
        .set('authorization', owner.auth)
        .send({ ...body, price: { amount: 900_000 }, validityMonths: 6 });
      expect(updated.body).toMatchObject({ price: { amount: 900_000 }, validityMonths: 6 });
      const listed = await http().get('/api/v1/admin/certificates/products').set('authorization', finance.auth);
      expect(listed.status).toBe(200);
      expect(listed.body).toHaveLength(1);

      const pub = await http().get('/api/v1/public/certificates/products?locale=kk');
      expect(pub.status).toBe(200);
      expect(pub.body[0]).toMatchObject({ slug: 'nominal-10000', name: '10 000 ₸ сертификаты', nominal: { amount: 1_000_000, currency: 'KZT' } });

      expect((await http().delete(`/api/v1/admin/certificates/products/${created.body.id}`).set('authorization', owner.auth)).status).toBe(204);
      expect((await http().get('/api/v1/public/certificates/products')).body).toEqual([]);
      expect(await auditActions(ctx.t, created.body.id)).toEqual([
        'certificate_product.created',
        'certificate_product.updated',
        'certificate_product.deleted',
      ]);
    });
  });

  describe('online purchase', () => {
    it('validates consent, quantity and delivery contacts', async () => {
      const product = await createCertificateProduct(ctx);
      const noConsent = await http().post('/api/v1/public/certificates/purchase').send(purchaseBody(product.id, { consent: { personalData: false } }));
      expect(noConsent.status).toBe(422);
      expect(noConsent.body.error.code).toBe('consent.required');
      expect((await http().post('/api/v1/public/certificates/purchase').send(purchaseBody(product.id, { quantity: 11 }))).status).toBe(400);
      const noEmail = await http()
        .post('/api/v1/public/certificates/purchase')
        .send(purchaseBody(product.id, { buyer: { name: 'Гость', phone: '+77015554433' }, recipient: { name: 'Друг' } }));
      expect(noEmail.status).toBe(400);
      const badChannel = await http().post('/api/v1/public/certificates/purchase').send(purchaseBody(product.id, { deliveryChannel: 'none' }));
      expect(badChannel.status).toBe(400);
      const badPhone = await http()
        .post('/api/v1/public/certificates/purchase')
        .send(purchaseBody(product.id, { buyer: { name: 'Гость', phone: '123', email: 'g@example.kz' } }));
      expect(badPhone.body.error.code).toBe('phone.invalid');
    });

    it('purchase -> online payment -> issue certificates with PDF and delivery; codes stored as hashes only', async () => {
      const product = await createCertificateProduct(ctx, { nominal: Money.tenge(10_000), price: Money.tenge(9_500) });
      const body = purchaseBody(product.id);
      const res = await http().post('/api/v1/public/certificates/purchase').set('x-forwarded-for', '10.1.1.1').send(body);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'awaiting_payment', total: { amount: 1_900_000 }, payment: { status: 'created', paymentUrl: null } });
      const again = await http().post('/api/v1/public/certificates/purchase').send(body);
      expect(again.body.orderToken).toBe(res.body.orderToken);
      // Согласие зафиксировано в базе гостей: версия текста, источник, IP.
      expect(ctx.fakes.customers.consents).toEqual([
        expect.objectContaining({ kind: 'personal_data', granted: true, textVersion: '2026-09-25', source: 'web', ip: '10.1.1.1' }),
      ]);

      await ctx.t.drain();
      const status = await http().get(`/api/v1/public/certificates/orders/${res.body.orderToken}?locale=ru`);
      expect(status.status).toBe(200);
      expect(status.body).toMatchObject({ status: 'awaiting_payment', quantity: 2, recipientName: 'Данияр', certificates: [] });
      expect(status.body.payment.paymentUrl).toContain('/public/payments/sandbox/');

      await sandboxDecision(ctx, status.body.payment.paymentUrl, 'succeeded');
      await ctx.t.drain();
      const issued = await http().get(`/api/v1/public/certificates/orders/${res.body.orderToken}`);
      expect(issued.body.status).toBe('issued');
      expect(issued.body.certificates).toHaveLength(2);
      expect(issued.body.certificates[0].maskedCode).toMatch(/^\*\*\*\*-\*\*\*\*-[A-Z2-9]{4}$/);

      const events = await publishedEvents(ctx.t, PaymentsEvents.CertificateIssued);
      expect(events).toHaveLength(2);
      expect(events[0]!.payload).toMatchObject({ productId: product.id, kind: 'amount', nominal: { amount: 1_000_000 }, price: { amount: 950_000 } });
      expect(events[0]!.payload.buyerPhone).toBe('+77015554433');

      const deliveries = ctx.fakes.notifier.guest.filter((g) => g.template === 'certificate.issued');
      expect(deliveries).toHaveLength(2);
      const params = deliveries[0]!.params as Record<string, string>;
      expect(params.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(params).toMatchObject({ recipientName: 'Данияр', message: 'С днём рождения!' });
      expect(params.pdfUrl).toContain('/files/private');
      expect(deliveries[0]!.recipient).toMatchObject({ email: 'daniyar@example.kz' });
      const emailInput = ctx.guestInputs.find((g) => g.template === 'certificate.issued');
      expect(emailInput).toMatchObject({ channels: ['email'], locale: 'ru' });
      expect(emailInput.attachments).toEqual([expect.objectContaining({ contentType: 'application/pdf', fileKey: expect.stringMatching(/^certificates\/.+\.pdf$/) })]);

      const rows = await sql<{ id: string; code_hash: string; last4: string; pdf_file_key: string; balance_amount: number }>`
        select id, code_hash, last4, pdf_file_key, balance_amount from payments.gift_certificates order by issued_at, id`.execute(
        ctx.t.database.rootConnection(),
      );
      const codes = deliveries.map((d) => (d.params as { code: string }).code);
      for (const row of rows.rows) {
        expect(codes.some((c) => c.endsWith(row.last4.trim()))).toBe(true);
        expect(codes.some((c) => row.code_hash.includes(c.replace(/-/g, '')))).toBe(false);
        const pdf = await ctx.t.get(FileStorage).get(row.pdf_file_key, 'private');
        expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      }
      // Полный код нигде в БД модуля не хранится.
      const dump = await sql<{ t: string }>`select row_to_json(g)::text as t from payments.gift_certificates g`.execute(ctx.t.database.rootConnection());
      for (const code of codes) expect(dump.rows.map((r) => r.t).join()).not.toContain(code.replace(/-/g, ''));

      // Повторная доставка события оплаты не выпускает сертификаты второй раз.
      expect((await sql<{ n: number }>`select count(*)::int as n from payments.gift_certificates`.execute(ctx.t.database.rootConnection())).rows[0]!.n).toBe(2);
      expect(await auditActions(ctx.t)).toEqual(expect.arrayContaining(['certificate_order.created', 'certificate.issued', 'certificate_order.issued']));
    });

    it('failed payment marks the order payment_failed; WhatsApp delivery requests a link', async () => {
      const product = await createCertificateProduct(ctx);
      const res = await http()
        .post('/api/v1/public/certificates/purchase')
        .send(purchaseBody(product.id, { quantity: 1, deliveryChannel: 'whatsapp', recipient: { name: 'Друг', phone: '+77019998877' } }));
      await ctx.t.drain();
      const status = await http().get(`/api/v1/public/certificates/orders/${res.body.orderToken}`);
      await sandboxDecision(ctx, status.body.payment.paymentUrl, 'failed');
      await ctx.t.drain();
      expect((await http().get(`/api/v1/public/certificates/orders/${res.body.orderToken}`)).body.status).toBe('payment_failed');
      expect((await http().get('/api/v1/public/certificates/orders/unknown-token')).status).toBe(404);

      const second = await http()
        .post('/api/v1/public/certificates/purchase')
        .send(purchaseBody(product.id, { quantity: 1, deliveryChannel: 'whatsapp', recipient: { name: 'Друг', phone: '+77019998877' } }));
      await ctx.t.drain();
      const st2 = await http().get(`/api/v1/public/certificates/orders/${second.body.orderToken}`);
      await sandboxDecision(ctx, st2.body.payment.paymentUrl, 'succeeded');
      await ctx.t.drain();
      const delivery = ctx.fakes.notifier.guest.find((g) => g.template === 'certificate.issued')!;
      expect(delivery.recipient).toMatchObject({ phone: '+77019998877', email: null });
      expect((delivery.params as { pdfUrl: string }).pdfUrl).toContain('/files/private');
      const input = ctx.guestInputs.find((g) => g.template === 'certificate.issued');
      expect(input).toMatchObject({ channels: ['whatsapp', 'sms'] });
      expect(input.attachments).toBeUndefined();
    });

    it('full refund of the purchase blocks unused certificates', async () => {
      const product = await createCertificateProduct(ctx);
      const res = await http().post('/api/v1/public/certificates/purchase').send(purchaseBody(product.id, { quantity: 1 }));
      await ctx.t.drain();
      const st = await http().get(`/api/v1/public/certificates/orders/${res.body.orderToken}`);
      await sandboxDecision(ctx, st.body.payment.paymentUrl, 'succeeded');
      await ctx.t.drain();
      await ctx.t.get(PaymentsService).requestRefund({ paymentId: res.body.payment.id, reason: 'Покупатель передумал', idempotencyKey: 'cert-rf' });
      await ctx.t.drain();
      const cert = await sql<{ status: string; status_reason: string }>`select status, status_reason from payments.gift_certificates`.execute(
        ctx.t.database.rootConnection(),
      );
      expect(cert.rows[0]).toEqual({ status: 'blocked', status_reason: 'purchase refunded' });
    });
  });

  describe('check and brute-force protection', () => {
    it('public check returns a masked view; unknown code is 404', async () => {
      const [cert] = await issueCertificate(ctx, { nominal: 20_000 });
      const res = await http().post('/api/v1/public/certificates/check').send({ code: ` ${cert!.code.toLowerCase().replace(/-/g, ' ')} ` });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ kind: 'amount', status: 'active', balance: { amount: 2_000_000 }, nominal: { amount: 2_000_000 } });
      expect(res.body.maskedCode).toBe(`****-****-${cert!.code.slice(-4)}`);
      expect(res.body.id).toBeUndefined();
      expect(res.body.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const bad = await http().post('/api/v1/public/certificates/check').send({ code: 'AAAA-BBBB-CCCC' });
      expect(bad.status).toBe(404);
      expect(bad.body.error.code).toBe('certificate.not_found');
    });

    it('blocks an IP for an hour after 20 failures within an hour', async () => {
      const [cert] = await issueCertificate(ctx);
      const limiter = ctx.t.get(RateLimiter);
      for (let i = 0; i < 20; i++) {
        limiter.clearMemory();
        const res = await http().post('/api/v1/public/certificates/check').set('x-forwarded-for', '10.9.9.9').send({ code: `ZZZZ-ZZZZ-${String(i).padStart(4, 'Z').replace(/[01]/g, 'Z')}` });
        expect(res.status).toBe(404);
      }
      limiter.clearMemory();
      const blocked = await http().post('/api/v1/public/certificates/check').set('x-forwarded-for', '10.9.9.9').send({ code: cert!.code });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('certificate.check_blocked');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(3000);
      // Другой IP не затронут; оплата сертификатом с заблокированного IP тоже отклоняется.
      expect((await http().post('/api/v1/public/certificates/check').set('x-forwarded-for', '10.8.8.8').send({ code: cert!.code })).status).toBe(200);
      ctx.t.clock.advance(61 * 60_000);
      limiter.clearMemory();
      expect((await http().post('/api/v1/public/certificates/check').set('x-forwarded-for', '10.9.9.9').send({ code: cert!.code })).status).toBe(200);
    });

    it('rate limits the public check endpoint', async () => {
      let last = 0;
      for (let i = 0; i < 11; i++) {
        last = (await http().post('/api/v1/public/certificates/check').set('x-forwarded-for', '10.7.7.7').send({ code: 'AAAA-BBBB-CCCC' })).status;
      }
      expect(last).toBe(429);
    });

    it('global failure counter alerts staff about distributed brute-force', async () => {
      const repo = ctx.t.get(CertificateCheckRepository);
      const now = ctx.t.clock.now();
      for (let i = 0; i < 200; i++) await repo.recordFailure(`10.0.${Math.floor(i / 50)}.${i % 50}`, now, new Date(now.getTime() - 3600_000));
      await ctx.t.runSchedule('payments.certificate_checks_monitor');
      expect(ctx.fakes.notifier.staff.map((s) => s.template)).toEqual(['staff.system_alert']);
    });

    it('admin check (point staff) includes the certificate id', async () => {
      const [cert] = await issueCertificate(ctx);
      const operator = await tokenFor(ctx.t, [{ role: 'branch_operator', branchId: branchA }]);
      const res = await http().post('/api/v1/admin/certificates/check').set('authorization', operator.auth).send({ code: cert!.code });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: cert!.id, status: 'active' });
      const content = await tokenFor(ctx.t, [{ role: 'content_manager' }]);
      expect((await http().post('/api/v1/admin/certificates/check').set('authorization', content.auth).send({ code: cert!.code })).status).toBe(403);
    });
  });

  describe('redemption at the point', () => {
    it('partial redemption in own branch, ledger, event, audit; never below zero', async () => {
      const [cert] = await issueCertificate(ctx, { nominal: 10_000 });
      const operator = await tokenFor(ctx.t, [{ role: 'branch_operator', branchId: branchA }], 'Кассир');
      const foreign = await http()
        .post('/api/v1/admin/certificates/redeem')
        .set('authorization', operator.auth)
        .send({ code: cert!.code, amount: { amount: 300_000 }, branchId: branchB });
      expect(foreign.status).toBe(403);

      const res = await http()
        .post('/api/v1/admin/certificates/redeem')
        .set('authorization', operator.auth)
        .send({ code: cert!.code, amount: { amount: 300_000 }, branchId: branchA, comment: 'Чек 123' });
      expect(res.status).toBe(200);
      expect(res.body.certificate).toMatchObject({ id: cert!.id, balance: { amount: 700_000 }, status: 'active' });
      expect(res.body.transaction).toMatchObject({ kind: 'debit', channel: 'point', branchId: branchA, actorName: 'Кассир', comment: 'Чек 123' });

      const over = await http()
        .post('/api/v1/admin/certificates/redeem')
        .set('authorization', operator.auth)
        .send({ code: cert!.code, amount: { amount: 700_001 }, branchId: branchA });
      expect(over.status).toBe(409);
      expect(over.body.error.code).toBe('certificate.insufficient_balance');
      const zero = await http().post('/api/v1/admin/certificates/redeem').set('authorization', operator.auth).send({ code: cert!.code, amount: { amount: 0 }, branchId: branchA });
      expect(zero.status).toBe(422);

      const rest = await http()
        .post('/api/v1/admin/certificates/redeem')
        .set('authorization', operator.auth)
        .send({ code: cert!.code, amount: { amount: 700_000 }, branchId: branchA });
      expect(rest.body.certificate).toMatchObject({ status: 'redeemed', balance: { amount: 0 } });
      const done = await http().post('/api/v1/admin/certificates/redeem').set('authorization', operator.auth).send({ code: cert!.code, amount: { amount: 1 }, branchId: branchA });
      expect(done.body.error.code).toBe('certificate.fully_redeemed');

      const events = await publishedEvents(ctx.t, PaymentsEvents.CertificateRedeemed);
      expect(events.map((e) => [e.payload.channel, e.payload.amount.amount, e.payload.balanceAfter.amount, e.payload.branchId])).toEqual([
        ['point', 300_000, 700_000, branchA],
        ['point', 700_000, 0, branchA],
      ]);
      const audit = await auditEntries(ctx.t, 'certificate.redeemed');
      expect(audit[0]).toMatchObject({ actor_kind: 'staff', entity_id: cert!.id });
      expect(audit[0]!.before.balance.amount).toBe(1_000_000);
      expect(audit[0]!.after.balance.amount).toBe(700_000);
      expect(ctx.fakes.notifier.guest.filter((g) => g.template === 'certificate.redeemed')).toHaveLength(2);
      await expect(sql`update payments.gift_certificates set balance_amount = -1 where id = ${cert!.id}`.execute(ctx.t.database.rootConnection())).rejects.toThrow(
        /gift_certificates_balance_non_negative/,
      );
    });

    it('set certificates are redeemed in full only; concurrent redemptions cannot overdraw', async () => {
      const [set] = await issueCertificate(ctx, { kind: 'set', nominal: 25_000 });
      const manager = await tokenFor(ctx.t, [{ role: 'branch_manager', branchId: branchA }]);
      const partial = await http()
        .post('/api/v1/admin/certificates/redeem')
        .set('authorization', manager.auth)
        .send({ code: set!.code, amount: { amount: 100_000 }, branchId: branchA });
      expect(partial.body.error.code).toBe('certificate.set_full_redemption_only');
      const full = await http().post('/api/v1/admin/certificates/redeem').set('authorization', manager.auth).send({ code: set!.code, branchId: branchA });
      expect(full.body.certificate).toMatchObject({ kind: 'set', status: 'redeemed', balance: { amount: 0 } });

      const [cert] = await issueCertificate(ctx, { nominal: 10_000 });
      const attempts = await Promise.all(
        [1, 2, 3].map(() =>
          http().post('/api/v1/admin/certificates/redeem').set('authorization', manager.auth).send({ code: cert!.code, amount: { amount: 600_000 }, branchId: branchA }),
        ),
      );
      expect(attempts.map((a) => a.status).sort()).toEqual([200, 409, 409]);
      const balance = await sql<{ balance_amount: number }>`select balance_amount from payments.gift_certificates where id = ${cert!.id}`.execute(
        ctx.t.database.rootConnection(),
      );
      expect(Number(balance.rows[0]!.balance_amount)).toBe(400_000);
    });
  });

  describe('admin management', () => {
    it('lists and searches certificates; details include the ledger', async () => {
      const [a] = await issueCertificate(ctx, { nominal: 5_000 });
      await issueCertificate(ctx, { nominal: 7_000 });
      const finance = await tokenFor(ctx.t, [{ role: 'finance' }]);
      const content = await tokenFor(ctx.t, [{ role: 'content_manager' }]);
      expect((await http().get('/api/v1/admin/certificates').set('authorization', content.auth)).status).toBe(403);
      const all = await http().get('/api/v1/admin/certificates').set('authorization', finance.auth);
      expect(all.body.total).toBe(2);
      const byLast4 = await http().get(`/api/v1/admin/certificates?q=${a!.code.slice(-4)}`).set('authorization', finance.auth);
      expect(byLast4.body.items.map((c: any) => c.id)).toContain(a!.id);
      const byPhone = await http().get('/api/v1/admin/certificates?phone=87011234567').set('authorization', finance.auth);
      expect(byPhone.body.total).toBe(2);
      const byStatus = await http().get('/api/v1/admin/certificates?status=redeemed').set('authorization', finance.auth);
      expect(byStatus.body.total).toBe(0);

      const details = await http().get(`/api/v1/admin/certificates/${a!.id}`).set('authorization', finance.auth);
      expect(details.status).toBe(200);
      expect(details.body.certificate).toMatchObject({ id: a!.id, maskedCode: `****-****-${a!.code.slice(-4)}`, hasPdf: true, buyer: { name: 'ТОО Ромашка' } });
      expect(details.body.ledger.map((l: any) => l.kind)).toEqual(['issue']);
      expect(details.body.order).toMatchObject({ source: 'manual', status: 'issued', buyerCompany: 'ТОО Ромашка' });
      expect(JSON.stringify(details.body)).not.toContain(a!.code);
    });

    it('block/unblock, extend with audit, daily expiry, resend, pdf link', async () => {
      const [cert] = await issueCertificate(ctx, { nominal: 10_000, validityMonths: 1 });
      const owner = await tokenFor(ctx.t, [{ role: 'owner' }]);
      const manager = await tokenFor(ctx.t, [{ role: 'branch_manager', branchId: branchA }]);

      expect((await http().post(`/api/v1/admin/certificates/${cert!.id}/block`).set('authorization', manager.auth).send({ reason: 'x' })).status).toBe(403);
      const blocked = await http().post(`/api/v1/admin/certificates/${cert!.id}/block`).set('authorization', owner.auth).send({ reason: 'Утерян' });
      expect(blocked.body).toMatchObject({ status: 'blocked', statusReason: 'Утерян' });
      const denied = await http().post('/api/v1/admin/certificates/redeem').set('authorization', owner.auth).send({ code: cert!.code, amount: { amount: 100 }, branchId: branchA });
      expect(denied.body.error.code).toBe('certificate.blocked');
      const unblocked = await http().post(`/api/v1/admin/certificates/${cert!.id}/unblock`).set('authorization', owner.auth).send({});
      expect(unblocked.body.status).toBe('active');

      // Истечение срока — ежедневная задача.
      ctx.t.clock.advance(40 * 86_400_000);
      await ctx.t.runSchedule('payments.certificates_expire');
      const expired = await http().get(`/api/v1/admin/certificates/${cert!.id}`).set('authorization', owner.auth);
      expect(expired.body.certificate.status).toBe('expired');
      expect(expired.body.ledger.map((l: any) => l.kind)).toEqual(['issue', 'expire']);
      const [expiredEvent] = await publishedEvents(ctx.t, PaymentsEvents.CertificateExpired);
      expect(expiredEvent!.payload).toMatchObject({ certificateId: cert!.id, balance: { amount: 1_000_000 } });
      await ctx.t.runSchedule('payments.certificates_expire');
      expect(await publishedEvents(ctx.t, PaymentsEvents.CertificateExpired)).toHaveLength(1);

      const badExtend = await http().post(`/api/v1/admin/certificates/${cert!.id}/extend`).set('authorization', owner.auth).send({ validUntil: '2026-01-01', reason: 'x1' });
      expect(badExtend.status).toBe(422);
      const extended = await http()
        .post(`/api/v1/admin/certificates/${cert!.id}/extend`)
        .set('authorization', owner.auth)
        .send({ validUntil: '2027-12-31', reason: 'Жалоба гостя' });
      expect(extended.body).toMatchObject({ status: 'active', validUntil: '2027-12-31' });
      // Восстановление остатка объявляется событием (проекция обязательств в Reporting).
      const reinstated = await publishedEvents(ctx.t, PaymentsEvents.CertificateReinstated);
      expect(reinstated.map((e) => e.payload)).toEqual([
        expect.objectContaining({ certificateId: cert!.id, kind: 'amount', balance: { amount: 1_000_000, currency: 'KZT' } }),
      ]);
      const audit = await auditEntries(ctx.t, 'certificate.extended');
      expect(audit[0]!.before.status).toBe('expired');
      expect(audit[0]!.after.expiresAt).not.toBe(audit[0]!.before.expiresAt);

      ctx.fakes.notifier.clear();
      const resend = await http().post(`/api/v1/admin/certificates/${cert!.id}/resend`).set('authorization', owner.auth).send({ email: 'new@example.kz' });
      expect(resend.status).toBe(200);
      expect(resend.body.deliveryCount).toBe(2);
      const msg = ctx.fakes.notifier.guest[0]!;
      expect(msg).toMatchObject({ template: 'certificate.issued', recipient: expect.objectContaining({ email: 'new@example.kz' }) });
      expect((msg.params as { code: string }).code).toBe(`****-****-${cert!.code.slice(-4)}`);

      expect((await http().get(`/api/v1/admin/certificates/${cert!.id}/pdf-link`).set('authorization', manager.auth)).status).toBe(403);
      const link = await http().get(`/api/v1/admin/certificates/${cert!.id}/pdf-link`).set('authorization', owner.auth);
      expect(link.body.url).toContain('/files/private');
      expect(await auditActions(ctx.t, cert!.id)).toEqual(
        expect.arrayContaining(['certificate.blocked', 'certificate.unblocked', 'certificate.expired', 'certificate.extended', 'certificate.resent', 'certificate.pdf_accessed']),
      );
    });

    it('manual issue for a corporate bank transfer (payments.manual), idempotent', async () => {
      const product = await createCertificateProduct(ctx, { nominal: Money.tenge(10_000) });
      const finance = await tokenFor(ctx.t, [{ role: 'finance' }]);
      const content = await tokenFor(ctx.t, [{ role: 'content_manager' }]);
      const body = {
        productId: product.id,
        quantity: 3,
        total: { amount: 2_700_000 },
        buyer: { name: 'Бухгалтер', company: 'ТОО Альфа', email: 'buh@alfa.kz' },
        deliveryChannel: 'none',
        locale: 'kk',
        documentNumber: '555',
        paidAt: new Date(ctx.t.clock.now().getTime() - 3600_000).toISOString(),
        idempotencyKey: 'corp-issue-1',
      };
      expect((await http().post('/api/v1/admin/certificates/issue').set('authorization', content.auth).send(body)).status).toBe(403);
      const res = await http().post('/api/v1/admin/certificates/issue').set('authorization', finance.auth).send(body);
      expect(res.status).toBe(201);
      expect(res.body.order).toMatchObject({ source: 'manual', status: 'issued', quantity: 3, total: { amount: 2_700_000 } });
      expect(res.body.payment).toMatchObject({ status: 'succeeded', amount: { amount: 2_700_000 } });
      expect(res.body.certificates).toHaveLength(3);
      expect(ctx.fakes.notifier.guest).toHaveLength(0); // deliveryChannel none — PDF скачиваются в админке
      const again = await http().post('/api/v1/admin/certificates/issue').set('authorization', finance.auth).send(body);
      expect(again.body.certificates.map((c: any) => c.id)).toEqual(res.body.certificates.map((c: any) => c.id));
      const prices = (await publishedEvents(ctx.t, PaymentsEvents.CertificateIssued)).map((e) => e.payload.price.amount);
      expect(prices).toEqual([900_000, 900_000, 900_000]);
      const payment = (await publishedEvents(ctx.t, PaymentsEvents.PaymentSucceeded))[0]!.payload;
      expect(payment).toMatchObject({ method: 'bank_transfer', purpose: 'gift_certificate', amount: { amount: 2_700_000 } });
      await ctx.t.drain();
      expect((await sql<{ n: number }>`select count(*)::int as n from payments.gift_certificates`.execute(ctx.t.database.rootConnection())).rows[0]!.n).toBe(3);
    });

    it('report: issued, redeemed, returned, expired for the period and outstanding liability; XLSX export', async () => {
      const [a, b] = await issueCertificate(ctx, { nominal: 10_000, quantity: 2 });
      const [c] = await issueCertificate(ctx, { nominal: 5_000, validityMonths: 1 });
      const manager = await tokenFor(ctx.t, [{ role: 'branch_manager', branchId: branchA }]);
      const finance = await tokenFor(ctx.t, [{ role: 'finance' }]);
      await http().post('/api/v1/admin/certificates/redeem').set('authorization', manager.auth).send({ code: a!.code, amount: { amount: 250_000 }, branchId: branchA });
      await ctx.t.get(PaymentsService).createPayment({
        purpose: 'order',
        referenceId: 'o-1',
        branchId: branchA,
        method: 'gift_certificate',
        certificateCode: b!.code,
        amount: Money.tenge(1000),
        description: 'Заказ',
        customer: { phone: null },
        returnUrl: null,
        idempotencyKey: 'rep-1',
      });
      await http().post(`/api/v1/admin/certificates/${b!.id}/block`).set('authorization', (await tokenFor(ctx.t, [{ role: 'owner' }])).auth).send({ reason: 'Проверка' });
      ctx.t.clock.advance(40 * 86_400_000);
      await ctx.t.runSchedule('payments.certificates_expire');
      void c;

      expect((await http().get('/api/v1/admin/certificates/report?from=2026-10-01&to=2026-12-31').set('authorization', manager.auth)).status).toBe(403);
      const res = await http().get('/api/v1/admin/certificates/report?from=2026-10-01&to=2026-12-31').set('authorization', finance.auth);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        issued: { count: 3, nominal: { amount: 2_500_000 }, price: { amount: 2_500_000 } },
        redeemed: { operations: 2, certificates: 2, amount: { amount: 350_000 } },
        returned: { count: 0 },
        expired: { count: 1, amount: { amount: 500_000 } },
        liability: { active: { count: 1, amount: { amount: 750_000 } }, blocked: { count: 1, amount: { amount: 900_000 } } },
      });
      const empty = await http().get('/api/v1/admin/certificates/report?from=2025-01-01&to=2025-01-31').set('authorization', finance.auth);
      expect(empty.body.issued.count).toBe(0);
      expect((await http().get('/api/v1/admin/certificates/report?from=2026-12-01&to=2026-01-01').set('authorization', finance.auth)).status).toBe(422);
      const xlsx = await http()
        .get('/api/v1/admin/certificates/report/export?from=2026-10-01&to=2026-12-31')
        .set('authorization', finance.auth)
        .buffer(true)
        .parse((response, cb) => {
          const chunks: Buffer[] = [];
          response.on('data', (d: Buffer) => chunks.push(d));
          response.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(xlsx.status).toBe(200);
      expect(xlsx.headers['content-type']).toContain('spreadsheetml');
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    });
  });
});
