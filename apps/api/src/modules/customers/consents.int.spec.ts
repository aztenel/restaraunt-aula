import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch, tokenFor } from '../../../test/support/fixtures';
import { TestApp } from '../../../test/support/test-app';
import { seedCustomers } from './infrastructure/seed';
import { CustomerDirectory } from './public';
import { createCustomersTestApp } from './testing/customers-test-kit';

const ADMIN = '/api/v1/admin/consent-texts';
const PUBLIC = '/api/v1/public/consents';

describe('Customers: consent texts and consents (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    ({ t } = await createCustomersTestApp());
  });
  afterAll(async () => t.close());
  beforeEach(async () => t.reset());

  const seedCtx = () => ({
    app: t.app,
    branches: {},
    legalEntityId: '',
    ownerUserId: '',
    demo: false,
    log: () => undefined,
  });

  it('seed publishes v1 texts for personal_data and marketing in kk and ru, idempotently', async () => {
    await seedCustomers(seedCtx());
    await seedCustomers(seedCtx());
    const rows = await sql<{ kind: string; version: string; text: Record<string, string> }>`
      select kind, version, text from customers.consent_texts order by kind`.execute(t.database.rootConnection());
    expect(rows.rows.map((r) => [r.kind, r.version])).toEqual([
      ['marketing', '2026-09-25'],
      ['personal_data', '2026-09-25'],
    ]);
    for (const r of rows.rows) {
      expect(r.text.ru).toBeTruthy();
      expect(r.text.kk).toBeTruthy();
    }
    expect(await t.get(CustomerDirectory).currentConsentVersion('personal_data')).toBe('2026-09-25');
  });

  it('demo seed creates guests with consents (idempotent)', async () => {
    const ctx = { ...seedCtx(), demo: true };
    await seedCustomers(ctx);
    await seedCustomers(ctx);
    const count = await sql<{ n: number; marketing: number }>`
      select count(*)::int as n, count(*) filter (where marketing_consent)::int as marketing from customers.customers`.execute(
      t.database.rootConnection(),
    );
    expect(count.rows[0]).toEqual({ n: 3, marketing: 2 });
  });

  it('public storefront gets the current text by locale', async () => {
    await seedCustomers(seedCtx());
    const kk = await t.http().get(`${PUBLIC}/personal_data?locale=kk`);
    expect(kk.status).toBe(200);
    expect(kk.body).toMatchObject({ kind: 'personal_data', version: '2026-09-25', locale: 'kk' });
    expect(kk.body.text).toContain('Заңы');
    const ru = await t.http().get(`${PUBLIC}/marketing`).set('accept-language', 'ru-RU');
    expect(ru.body.locale).toBe('ru');
    expect(ru.body.text).toContain('рассылки');
    expect((await t.http().get(`${PUBLIC}/cookies`)).status).toBe(400);
  });

  it('public endpoint returns 404 when no text is published', async () => {
    const res = await t.http().get(`${PUBLIC}/personal_data`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('consent_text.not_found');
  });

  it('admin publishes a new version (customers.manage): becomes current, versions are immutable, audited', async () => {
    await seedCustomers(seedCtx());
    const { auth } = await tokenFor(t, [{ role: 'banquet_manager' }]);
    const text = { ru: 'Новая редакция согласия', kk: 'Келісімнің жаңа редакциясы' };
    const res = await t.http().post(ADMIN).set('authorization', auth).send({ kind: 'personal_data', version: '2026-10-15', text });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'personal_data', version: '2026-10-15', text, isCurrent: true });

    expect((await t.http().get(`${PUBLIC}/personal_data?locale=ru`)).body).toMatchObject({ version: '2026-10-15', text: text.ru });
    expect(await t.get(CustomerDirectory).currentConsentVersion('personal_data')).toBe('2026-10-15');
    expect(await t.get(CustomerDirectory).currentConsentVersion('marketing')).toBe('2026-09-25');

    const dup = await t.http().post(ADMIN).set('authorization', auth).send({ kind: 'personal_data', version: '2026-10-15', text });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('consent_text.version_exists');

    const noKk = await t.http().post(ADMIN).set('authorization', auth).send({ kind: 'marketing', version: 'v2', text: { ru: 'Только ru' } });
    expect(noKk.status).toBe(422);
    expect(noKk.body.error.code).toBe('consent_text.translation_required');

    const list = await t.http().get(`${ADMIN}?kind=personal_data`).set('authorization', auth);
    expect(list.body.map((v: { version: string; isCurrent: boolean }) => [v.version, v.isCurrent])).toEqual([
      ['2026-10-15', true],
      ['2026-09-25', false],
    ]);

    await expect(sql`update customers.consent_texts set version = 'x'`.execute(t.database.rootConnection())).rejects.toThrow(/append-only/);

    const audit = await sql<{ action: string }>`select action from platform.audit_log where entity_type = 'consent_text'`.execute(
      t.database.rootConnection(),
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['consent_text.published']);
  });

  it('permissions: 401 without token, 403 without customers.manage / customers.view', async () => {
    const text = { ru: 'Текст', kk: 'Мәтін' };
    expect((await t.http().post(ADMIN).send({ kind: 'marketing', version: 'v2', text })).status).toBe(401);
    const branchId = await createBranch(t);
    const operator = await tokenFor(t, [{ role: 'branch_operator', branchId }]);
    expect((await t.http().get(ADMIN).set('authorization', operator.auth)).status).toBe(200);
    const denied = await t.http().post(ADMIN).set('authorization', operator.auth).send({ kind: 'marketing', version: 'v2', text });
    expect(denied.status).toBe(403);
    const content = await tokenFor(t, [{ role: 'content_manager' }]);
    expect((await t.http().get(ADMIN).set('authorization', content.auth)).status).toBe(403);
  });

  it('staff records consent obtained by phone: history with source and employee, audited', async () => {
    await seedCustomers(seedCtx());
    const { customerId } = await t.get(CustomerDirectory).identify({ phone: '+77011234567' });
    const { auth, userId } = await tokenFor(t, [{ role: 'banquet_manager' }]);
    const res = await t
      .http()
      .post(`/api/v1/admin/customers/${customerId}/consents`)
      .set('authorization', auth)
      .send({ kind: 'marketing', granted: true, source: 'phone' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ marketingConsent: true, marketingConsentVersion: '2026-09-25' });

    const detail = await t.http().get(`/api/v1/admin/customers/${customerId}`).set('authorization', auth);
    expect(detail.body.consents[0]).toMatchObject({ kind: 'marketing', granted: true, source: 'phone', recordedBy: userId, textVersion: '2026-09-25' });

    const bad = await t
      .http()
      .post(`/api/v1/admin/customers/${customerId}/consents`)
      .set('authorization', auth)
      .send({ kind: 'marketing', granted: true, source: 'web' });
    expect(bad.status).toBe(400);

    const audit = await sql<{ action: string }>`select action from platform.audit_log where entity_id = ${customerId}`.execute(
      t.database.rootConnection(),
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['customer.consent_recorded']);
  });
});
