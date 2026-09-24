import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Fakes } from '../../../test/fakes';
import { tokenFor } from '../../../test/support/fixtures';
import { TestApp } from '../../../test/support/test-app';
import { createCustomersTestApp, publishInitialConsentTexts } from './testing/customers-test-kit';
import { CustomerDirectory, CustomersEvents } from './public';

describe('Customers: CustomerDirectory contract (integration)', () => {
  let t: TestApp;
  let fakes: Fakes;
  let directory: CustomerDirectory;
  let version: string;

  beforeAll(async () => {
    ({ t, fakes } = await createCustomersTestApp());
    directory = t.get(CustomerDirectory);
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    fakes.notifier.clear();
    version = await publishInitialConsentTexts(t);
  });

  async function outbox(topic: string) {
    const r = await sql<{ payload: { payload: Record<string, unknown> } }>`
      select payload from platform.outbox where topic = ${topic} order by created_at`.execute(t.database.rootConnection());
    return r.rows.map((row) => row.payload.payload);
  }

  it('identifies by normalized phone: one customer for any phone format, CustomerCreated once', async () => {
    const first = await directory.identify({ phone: '8 (701) 123-45-67', name: '  Асель ', email: 'Asel@Mail.KZ', locale: 'kk' });
    expect(first.isNew).toBe(true);
    const second = await directory.identify({ phone: '+7 701 123 45 67' });
    const third = await directory.identify({ phone: '7011234567' });
    expect(second).toEqual({ customerId: first.customerId, isNew: false });
    expect(third.customerId).toBe(first.customerId);

    const profile = await directory.get(first.customerId);
    expect(profile).toMatchObject({
      phone: '+77011234567',
      name: 'Асель',
      email: 'asel@mail.kz',
      locale: 'kk',
      tags: [],
      personalDataConsent: false,
      marketingConsent: false,
    });
    const created = await outbox(CustomersEvents.CustomerCreated);
    expect(created).toEqual([{ customerId: first.customerId, phone: '+77011234567', occurredAt: t.clock.now().toISOString() }]);
  });

  it('rejects invalid phones', async () => {
    await expect(directory.identify({ phone: '12345' })).rejects.toMatchObject({ code: 'phone.invalid' });
    await expect(directory.findByPhone('not a phone')).resolves.toBeNull();
  });

  it('form data never overwrites data entered by a manager; fills only empty fields', async () => {
    const { customerId } = await directory.identify({ phone: '+77011234567' });
    const { auth } = await tokenFor(t, [{ role: 'owner' }]);
    const patched = await t
      .http()
      .patch(`/api/v1/admin/customers/${customerId}`)
      .set('authorization', auth)
      .send({ name: 'Асель Нурланқызы (VIP)' });
    expect(patched.status).toBe(200);

    await directory.identify({ phone: '87011234567', name: 'Aselka', email: 'asel@mail.kz' });
    const profile = await directory.get(customerId);
    expect(profile.name).toBe('Асель Нурланқызы (VIP)');
    expect(profile.email).toBe('asel@mail.kz');

    await directory.identify({ phone: '87011234567', email: 'other@mail.kz' });
    expect((await directory.get(customerId)).email).toBe('asel@mail.kz');
  });

  it('concurrent identify with the same phone creates a single customer', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => directory.identify({ phone: '+77015550000', name: `Гость ${i}` })),
    );
    const ids = new Set(results.map((r) => r.customerId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.isNew)).toHaveLength(1);
    const count = await sql<{ n: number }>`select count(*)::int as n from customers.customers`.execute(t.database.rootConnection());
    expect(count.rows[0]!.n).toBe(1);
  });

  it('findByPhone and get', async () => {
    const { customerId } = await directory.identify({ phone: '+77011234567', name: 'Асель' });
    expect((await directory.findByPhone('8 701 123 45 67'))?.id).toBe(customerId);
    expect(await directory.findByPhone('+77770000000')).toBeNull();
    await expect(directory.get('0192a0b4-7a1e-7c3e-9f5e-0c1d2e3f4a5b')).rejects.toMatchObject({ code: 'customer.not_found' });
  });

  it('records consents as append-only history with date, text version, source and IP', async () => {
    const { customerId } = await directory.identify({ phone: '+77011234567' });
    expect(await directory.currentConsentVersion('personal_data')).toBe(version);

    await directory.recordConsent({ customerId, kind: 'personal_data', granted: true, textVersion: version, source: 'web', ip: '10.0.0.1' });
    await directory.recordConsent({ customerId, kind: 'marketing', granted: true, textVersion: version, source: 'web', ip: '10.0.0.1' });
    t.clock.advance(60_000);
    await directory.recordConsent({ customerId, kind: 'marketing', granted: false, textVersion: version, source: 'phone' });

    const profile = await directory.get(customerId);
    expect(profile.personalDataConsent).toBe(true);
    expect(profile.marketingConsent).toBe(false);

    const rows = await sql<{ kind: string; granted: boolean; text_version: string; source: string; ip: string | null; recorded_at: Date }>`
      select kind, granted, text_version, source, ip, recorded_at from customers.consents where customer_id = ${customerId}
      order by recorded_at, kind desc`.execute(t.database.rootConnection());
    expect(rows.rows.map((r) => [r.kind, r.granted, r.text_version, r.source, r.ip])).toEqual([
      ['personal_data', true, version, 'web', '10.0.0.1'],
      ['marketing', true, version, 'web', '10.0.0.1'],
      ['marketing', false, version, 'phone', null],
    ]);
    // История только на добавление — на уровне БД.
    await expect(sql`update customers.consents set granted = false`.execute(t.database.rootConnection())).rejects.toThrow(/append-only/);
    await expect(sql`delete from customers.consents`.execute(t.database.rootConnection())).rejects.toThrow(/append-only/);
  });

  it('rejects consent with an unknown text version or kind', async () => {
    const { customerId } = await directory.identify({ phone: '+77011234567' });
    await expect(
      directory.recordConsent({ customerId, kind: 'personal_data', granted: true, textVersion: 'v999', source: 'web' }),
    ).rejects.toMatchObject({ code: 'consent.unknown_version' });
    await expect(
      directory.recordConsent({ customerId, kind: 'cookies' as never, granted: true, textVersion: version, source: 'web' }),
    ).rejects.toMatchObject({ code: 'consent.kind_invalid' });
    await expect(
      directory.recordConsent({
        customerId: '0192a0b4-7a1e-7c3e-9f5e-0c1d2e3f4a5b',
        kind: 'personal_data',
        granted: true,
        textVersion: version,
        source: 'web',
      }),
    ).rejects.toMatchObject({ code: 'customer.not_found' });
  });

  it('currentConsentVersion fails clearly when no text is published', async () => {
    await t.reset();
    await expect(directory.currentConsentVersion('marketing')).rejects.toMatchObject({ code: 'consent_text.not_found' });
  });

  it('addTag is idempotent and normalizes the tag', async () => {
    const { customerId } = await directory.identify({ phone: '+77011234567' });
    await directory.addTag(customerId, 'banquet');
    await directory.addTag(customerId, 'Banquet');
    await directory.addTag(customerId, 'corporate');
    expect((await directory.get(customerId)).tags).toEqual(['banquet', 'corporate']);
    await expect(directory.addTag(customerId, 'bad tag!')).rejects.toMatchObject({ code: 'customer.tag_invalid' });
  });
});
