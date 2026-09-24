import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch, tokenFor } from '../../../test/support/fixtures';
import { TestApp } from '../../../test/support/test-app';
import { newId } from '../../shared/kernel/ids';
import { BanquetEvents } from '../banquet/public';
import { OrderingEvents } from '../ordering/public';
import { CustomerDirectory, CustomersEvents } from './public';
import {
  banquetRequestCreated,
  createCustomersTestApp,
  orderCompleted,
  orderPlaced,
  publishAndDrain,
  publishInitialConsentTexts,
} from './testing/customers-test-kit';

const API = '/api/v1/admin/customers';
const SEGMENTS = '/api/v1/admin/customer-segments';

/** Двоичный ответ supertest -> Buffer. */
function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('Customers: admin (integration)', () => {
  let t: TestApp;
  let directory: CustomerDirectory;
  let owner: string;
  let version: string;

  beforeAll(async () => {
    ({ t } = await createCustomersTestApp());
    directory = t.get(CustomerDirectory);
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    version = await publishInitialConsentTexts(t);
    ({ auth: owner } = await tokenFor(t, [{ role: 'owner' }]));
  });

  /** Три гостя: постоянный с маркетинговым согласием, банкетный, новичок. */
  async function seedGuests() {
    const branchA = newId();
    const branchB = newId();
    const aigerim = await directory.identify({ phone: '+77011111111', name: 'Айгерим', email: 'aigerim@mail.kz' });
    await directory.recordConsent({ customerId: aigerim.customerId, kind: 'personal_data', granted: true, textVersion: version, source: 'web' });
    await directory.recordConsent({ customerId: aigerim.customerId, kind: 'marketing', granted: true, textVersion: version, source: 'web', ip: '1.2.3.4' });
    for (let i = 0; i < 3; i++) {
      const p = orderPlaced({
        branchId: branchA,
        customer: { customerId: aigerim.customerId, phone: '+77011111111', name: 'Айгерим' },
        total: { amount: 1_000_000, currency: 'KZT' },
      });
      await publishAndDrain(t, OrderingEvents.OrderPlaced, p);
      await publishAndDrain(t, OrderingEvents.OrderCompleted, orderCompleted(p, { completedAt: '2026-09-30T12:00:00.000Z' }));
    }
    await publishAndDrain(
      t,
      BanquetEvents.RequestCreated,
      banquetRequestCreated({
        branchId: branchB,
        contact: { customerId: null, name: 'Ерлан', phone: '+77022222222', email: 'erlan@romashka.kz' },
        occurredAt: '2026-09-10T12:00:00.000Z',
      }),
    );
    const erlan = (await directory.findByPhone('+77022222222'))!;
    const newbie = await directory.identify({ phone: '+77033333333', name: 'Новый гость' });
    return { branchA, branchB, aigerim: aigerim.customerId, erlan: erlan.id, newbie: newbie.customerId };
  }

  async function list(query: string, auth = owner) {
    const res = await t.http().get(`${API}${query}`).set('authorization', auth);
    expect(res.status).toBe(200);
    return res.body as { items: Array<{ id: string; phone: string | null }>; total: number };
  }

  it('lists and searches by phone, name, email; filters by tag, spent, activity, branch, banquet, consent', async () => {
    const g = await seedGuests();
    const all = await list('');
    expect(all.total).toBe(3);
    // Сортировка по умолчанию — последняя активность (без активности — в конце).
    expect(all.items.map((c) => c.id)).toEqual([g.aigerim, g.erlan, g.newbie]);

    expect((await list('?q=8 702 222')).items.map((c) => c.id)).toEqual([g.erlan]);
    expect((await list('?q=айгер')).items.map((c) => c.id)).toEqual([g.aigerim]);
    expect((await list('?q=ROMASHKA')).items.map((c) => c.id)).toEqual([g.erlan]);
    expect((await list('?tag=regular')).items.map((c) => c.id)).toEqual([g.aigerim]);
    expect((await list('?tag=banquet')).items.map((c) => c.id)).toEqual([g.erlan]);
    expect((await list('?tag=regular,banquet')).total).toBe(0);
    expect((await list('?spentMin=2000000')).items.map((c) => c.id)).toEqual([g.aigerim]);
    expect((await list('?spentMax=0&sort=name&order=asc')).items.map((c) => c.id)).toEqual([g.erlan, g.newbie]);
    expect((await list('?lastActivityFrom=2026-09-30&lastActivityTo=2026-09-30')).items.map((c) => c.id)).toEqual([g.aigerim]);
    expect((await list('?lastActivityTo=2026-09-15')).items.map((c) => c.id)).toEqual([g.erlan]);
    expect((await list(`?branchId=${g.branchB}`)).items.map((c) => c.id)).toEqual([g.erlan]);
    expect((await list('?hasBanquet=true')).items.map((c) => c.id)).toEqual([g.erlan]);
    expect((await list('?hasBanquet=false')).total).toBe(2);
    expect((await list('?marketingConsent=true')).items.map((c) => c.id)).toEqual([g.aigerim]);
    expect((await list('?perPage=1&page=2')).items.map((c) => c.id)).toEqual([g.erlan]);

    const bad = await t.http().get(`${API}?spentMin=abc`).set('authorization', owner);
    expect(bad.status).toBe(400);
    const unknown = await t.http().get(`${API}?foo=1`).set('authorization', owner);
    expect(unknown.status).toBe(400);

    const tags = await t.http().get(`${API}/tags`).set('authorization', owner);
    expect(tags.body).toEqual(
      expect.arrayContaining([
        { tag: 'regular', count: 1 },
        { tag: 'banquet', count: 1 },
      ]),
    );
  });

  it('permissions: network-wide view for any customers.view; manage and export need their permissions', async () => {
    const g = await seedGuests();
    expect((await t.http().get(API)).status).toBe(401);

    const branchId = await createBranch(t);
    const operator = await tokenFor(t, [{ role: 'branch_operator', branchId }]);
    // Оператор филиала видит гостей всей сети (гости не принадлежат филиалу).
    expect((await list('', operator.auth)).total).toBe(3);
    expect((await t.http().get(`${API}/${g.erlan}`).set('authorization', operator.auth)).status).toBe(200);
    const patch = await t.http().patch(`${API}/${g.erlan}`).set('authorization', operator.auth).send({ notes: 'x' });
    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe('access.forbidden');
    expect((await t.http().post(`${API}/${g.erlan}/anonymize`).set('authorization', operator.auth).send({})).status).toBe(403);

    const content = await tokenFor(t, [{ role: 'content_manager' }]);
    expect((await t.http().get(API).set('authorization', content.auth)).status).toBe(403);

    const banquet = await tokenFor(t, [{ role: 'banquet_manager' }]);
    expect((await t.http().patch(`${API}/${g.erlan}`).set('authorization', banquet.auth).send({ notes: 'VIP' })).status).toBe(200);
    const exp = await t.http().post(`${API}/export`).set('authorization', banquet.auth).send({ format: 'csv', purpose: 'service' });
    expect(exp.status).toBe(403);

    expect((await t.http().get(`${API}/${newId()}`).set('authorization', owner)).status).toBe(404);
    expect((await t.http().get(`${API}/not-a-uuid`).set('authorization', owner)).status).toBe(400);
  });

  it('PATCH updates the profile with validation; audit masks personal data', async () => {
    const g = await seedGuests();
    const res = await t
      .http()
      .patch(`${API}/${g.aigerim}`)
      .set('authorization', owner)
      .send({
        name: 'Айгерим Нурланқызы',
        email: 'A.New@Mail.kz',
        birthday: '1990-05-17',
        locale: 'kk',
        tags: ['VIP', 'regular'],
        allergies: 'арахис',
        preferences: 'столик у окна',
        notes: 'Любит бешбармак',
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Айгерим Нурланқызы',
      email: 'a.new@mail.kz',
      birthday: '1990-05-17',
      locale: 'kk',
      tags: ['vip', 'regular'],
      allergies: 'арахис',
      preferences: 'столик у окна',
      notes: 'Любит бешбармак',
      completedOrdersCount: 3,
    });

    const cleared = await t.http().patch(`${API}/${g.aigerim}`).set('authorization', owner).send({ notes: null });
    expect(cleared.body.notes).toBeNull();

    for (const [body, code] of [
      [{ email: 'broken@' }, 'customer.email_invalid'],
      [{ birthday: '2030-01-01' }, 'customer.birthday_invalid'],
      [{ tags: ['bad tag!'] }, 'customer.tag_invalid'],
    ] as const) {
      const bad = await t.http().patch(`${API}/${g.aigerim}`).set('authorization', owner).send(body);
      expect(bad.status, JSON.stringify(body)).toBe(422);
      expect(bad.body.error.code).toBe(code);
    }

    const audit = await sql<{ action: string; before: Record<string, unknown>; after: Record<string, unknown> }>`
      select action, before, after from platform.audit_log where entity_id = ${g.aigerim} order by occurred_at, id`.execute(
      t.database.rootConnection(),
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['customer.updated', 'customer.updated']);
    const first = audit.rows[0]!;
    expect(first.before).toMatchObject({ name: 'А***', email: 'a***@mail.kz', tags: ['regular'] });
    expect(first.after).toMatchObject({ name: 'А***', email: 'a***@mail.kz', tags: ['vip', 'regular'], locale: 'kk', allergies: '[6 симв.]' });
    expect(JSON.stringify(audit.rows)).not.toContain('Нурланқызы');
    expect(JSON.stringify(audit.rows)).not.toContain('арахис');
  });

  it('segments: CRUD, apply to the list, count', async () => {
    const g = await seedGuests();
    const created = await t
      .http()
      .post(SEGMENTS)
      .set('authorization', owner)
      .send({ name: 'Постоянные с рассылкой', description: 'Для акций', filter: { tags: ['regular'], marketingConsent: true } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Постоянные с рассылкой', filter: { tags: ['regular'], marketingConsent: true } });
    const id = created.body.id;

    const dup = await t.http().post(SEGMENTS).set('authorization', owner).send({ name: 'постоянные с РАССЫЛКОЙ', filter: {} });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('customer_segment.name_taken');
    const badFilter = await t.http().post(SEGMENTS).set('authorization', owner).send({ name: 'x', filter: { spentMin: 10, spentMax: 1 } });
    expect(badFilter.status).toBe(422);
    const unknownField = await t.http().post(SEGMENTS).set('authorization', owner).send({ name: 'x', filter: { foo: 1 } });
    expect(unknownField.status).toBe(400);

    const one = await t.http().get(`${SEGMENTS}/${id}`).set('authorization', owner);
    expect(one.body.customersCount).toBe(1);
    expect((await list(`?segmentId=${id}`)).items.map((c) => c.id)).toEqual([g.aigerim]);

    const updated = await t.http().patch(`${SEGMENTS}/${id}`).set('authorization', owner).send({ name: 'Все без банкетов', filter: { hasBanquet: false } });
    expect(updated.status).toBe(200);
    expect((await t.http().get(`${SEGMENTS}/${id}`).set('authorization', owner)).body.customersCount).toBe(2);
    expect((await t.http().get(SEGMENTS).set('authorization', owner)).body).toHaveLength(1);

    const branchId = await createBranch(t);
    const operator = await tokenFor(t, [{ role: 'branch_operator', branchId }]);
    expect((await t.http().get(SEGMENTS).set('authorization', operator.auth)).status).toBe(200);
    expect((await t.http().delete(`${SEGMENTS}/${id}`).set('authorization', operator.auth)).status).toBe(403);

    expect((await t.http().delete(`${SEGMENTS}/${id}`).set('authorization', owner)).status).toBe(204);
    expect((await t.http().get(`${SEGMENTS}/${id}`).set('authorization', owner)).status).toBe(404);
    const audit = await sql<{ action: string }>`
      select action from platform.audit_log where entity_type = 'customer_segment' order by occurred_at, id`.execute(t.database.rootConnection());
    expect(audit.rows.map((r) => r.action)).toEqual(['customer_segment.created', 'customer_segment.updated', 'customer_segment.deleted']);
  });

  it('exports XLSX: marketing purpose only includes guests with marketing consent; every export audited', async () => {
    await seedGuests();
    const res = await t
      .http()
      .post(`${API}/export`)
      .set('authorization', owner)
      .send({ format: 'xlsx', purpose: 'marketing' })
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('aula-customers-marketing-2026-10-01.xlsx');
    expect(res.headers['x-export-count']).toBe('1');

    const wb = new ExcelJS.Workbook();
    const body = res.body as Buffer;
    await wb.xlsx.load(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe('Гости');
    expect(ws.rowCount).toBe(2);
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header.slice(0, 3)).toEqual(['Телефон', 'Имя', 'Email']);
    const row = (ws.getRow(2).values as unknown[]).slice(1);
    expect(row[0]).toBe('+77011111111');
    expect(row[1]).toBe('Айгерим');
    expect(row[5]).toBe('regular');
    expect(row[8]).toBe(30_000); // 3 заказа по 10 000 ₸
    expect(row[12]).toBe('да');

    const service = await t
      .http()
      .post(`${API}/export`)
      .set('authorization', owner)
      .send({ format: 'xlsx', purpose: 'service' })
      .buffer(true)
      .parse(binary);
    expect(service.headers['x-export-count']).toBe('3');

    const audit = await sql<{ action: string; after: { purpose: string; count: number; filter: Record<string, unknown> } }>`
      select action, after from platform.audit_log where entity_type = 'customer_export' order by occurred_at, id`.execute(
      t.database.rootConnection(),
    );
    expect(audit.rows.map((r) => [r.action, r.after.purpose, r.after.count])).toEqual([
      ['customers.exported', 'marketing', 1],
      ['customers.exported', 'service', 3],
    ]);
    expect(audit.rows[0]!.after.filter).toEqual({ marketingConsent: true });
  });

  it('exports CSV by segment and filter; marketing export cannot target guests without consent', async () => {
    const g = await seedGuests();
    const segment = await t.http().post(SEGMENTS).set('authorization', owner).send({ name: 'Банкетные', filter: { hasBanquet: true } });
    const res = await t
      .http()
      .post(`${API}/export`)
      .set('authorization', owner)
      .send({ format: 'csv', purpose: 'service', segmentId: segment.body.id, filter: { q: 'ерлан' } });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const text = res.text.replace(/^﻿/, '');
    const lines = text.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Телефон,Имя,Email/);
    expect(lines[1]).toMatch(/^\+77022222222,Ерлан,erlan@romashka\.kz,ru,,banquet,0,0,0\.00,0,0,1,нет,/);

    const conflict = await t
      .http()
      .post(`${API}/export`)
      .set('authorization', owner)
      .send({ format: 'csv', purpose: 'marketing', filter: { marketingConsent: false } });
    expect(conflict.status).toBe(422);
    expect(conflict.body.error.code).toBe('customer_export.marketing_requires_consent');

    const badFormat = await t.http().post(`${API}/export`).set('authorization', owner).send({ format: 'pdf', purpose: 'service' });
    expect(badFormat.status).toBe(400);
    expect(g.erlan).toBeTruthy();
  });

  it('anonymize erases personal data, keeps aggregates; phone can be used again', async () => {
    const g = await seedGuests();
    const res = await t.http().post(`${API}/${g.aigerim}/anonymize`).set('authorization', owner).send({ reason: 'Заявление гостя' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      phone: null,
      name: null,
      email: null,
      birthday: null,
      allergies: null,
      notes: null,
      marketingConsent: false,
      completedOrdersCount: 3,
      totalSpent: { amount: 3_000_000, currency: 'KZT' },
      tags: ['regular'],
    });
    expect(res.body.anonymizedAt).toBeTruthy();

    const stored = await sql<{ phone: string }>`select phone from customers.customers where id = ${g.aigerim}`.execute(
      t.database.rootConnection(),
    );
    expect(stored.rows[0]!.phone).toMatch(/^anon:[0-9a-f]{64}$/);
    const ips = await sql<{ ip: string | null }>`select ip from customers.consents where customer_id = ${g.aigerim}`.execute(
      t.database.rootConnection(),
    );
    expect(ips.rows.every((r) => r.ip === null)).toBe(true);

    // Для других модулей гость больше не существует; телефон свободен.
    await expect(directory.get(g.aigerim)).rejects.toMatchObject({ code: 'customer.not_found' });
    expect(await directory.findByPhone('+77011111111')).toBeNull();
    const again = await directory.identify({ phone: '+77011111111', name: 'Айгерим' });
    expect(again.isNew).toBe(true);
    expect(again.customerId).not.toBe(g.aigerim);

    // Обезличенные скрыты из списка и выгрузок по умолчанию.
    expect((await list('')).items.map((c) => c.id)).not.toContain(g.aigerim);
    expect((await list('?includeAnonymized=true')).items.map((c) => c.id)).toContain(g.aigerim);
    expect((await list('?q=айгерим')).items.map((c) => c.id)).toEqual([again.customerId]);

    const repeat = await t.http().post(`${API}/${g.aigerim}/anonymize`).set('authorization', owner).send({});
    expect(repeat.status).toBe(409);
    expect(repeat.body.error.code).toBe('customer.already_anonymized');
    const patch = await t.http().patch(`${API}/${g.aigerim}`).set('authorization', owner).send({ name: 'x' });
    expect(patch.status).toBe(409);

    const audit = await sql<{ action: string; before: unknown; after: unknown }>`
      select action, before, after from platform.audit_log where entity_id = ${g.aigerim} and action = 'customer.anonymized'`.execute(
      t.database.rootConnection(),
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0])).not.toContain('+77011111111');
    const events = await sql<{ payload: { payload: unknown } }>`
      select payload from platform.outbox where topic = ${CustomersEvents.CustomerAnonymized}`.execute(t.database.rootConnection());
    expect(events.rows.map((r) => r.payload.payload)).toEqual([{ customerId: g.aigerim, occurredAt: t.clock.now().toISOString() }]);
  });
});
