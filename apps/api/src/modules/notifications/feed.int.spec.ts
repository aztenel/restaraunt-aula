import { request as httpRequest, IncomingMessage, ClientRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakes, fakeProviders } from '../../../test/fakes';
import { createBranch, tokenFor } from '../../../test/support/fixtures';
import { createTestApp, TestApp } from '../../../test/support/test-app';
import { UserRepository } from '../identity/infrastructure/user.repository';
import { NotificationsModule } from './notifications.module';
import { AdminFeed, AdminFeedEvent, Notifier } from './public';

type Row = Record<string, any>;

interface OpenStream {
  res: IncomingMessage;
  req: ClientRequest;
  received: () => string;
  events: () => Array<{ id: string | null; event: string; data: string }>;
  waitFor: (predicate: (text: string) => boolean, timeoutMs?: number) => Promise<void>;
  close: () => void;
}

describe('Admin feed (integration)', () => {
  let t: TestApp;
  let port: number;
  const fakes = createFakes();
  const streams: OpenStream[] = [];

  beforeAll(async () => {
    t = await createTestApp({
      imports: [NotificationsModule],
      migrateModules: ['notifications'],
      providers: fakeProviders(fakes, { except: [Notifier, AdminFeed] }),
    });
    const server = t.app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    for (const s of streams) s.close();
    await t.close();
  });
  beforeEach(async () => {
    for (const s of streams.splice(0)) s.close();
    await t.reset();
  });

  const rows = async (query: ReturnType<typeof sql>) => (await query.execute(t.database.rootConnection())).rows as Row[];
  const feed = () => t.get(AdminFeed);

  /** Короткое чтение SSE-потока настоящим HTTP-запросом. */
  function openStream(ticket: string, headers: Record<string, string> = {}): Promise<OpenStream> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path: `/api/v1/admin/feed/stream?ticket=${encodeURIComponent(ticket)}`, headers, agent: false },
        (res) => {
          res.setEncoding('utf8');
          let text = '';
          const waiters: Array<{ predicate: (text: string) => boolean; resolve: () => void }> = [];
          res.on('data', (chunk: string) => {
            text += chunk;
            for (const w of [...waiters]) {
              if (w.predicate(text)) {
                waiters.splice(waiters.indexOf(w), 1);
                w.resolve();
              }
            }
          });
          const stream: OpenStream = {
            res,
            req,
            received: () => text,
            events: () =>
              text
                .split('\n\n')
                .filter((block) => /^event: /m.test(block))
                .map((block) => ({
                  id: /^id: (.*)$/m.exec(block)?.[1] ?? null,
                  event: /^event: (.*)$/m.exec(block)![1]!,
                  data: /^data: (.*)$/m.exec(block)?.[1] ?? '',
                })),
            waitFor: (predicate, timeoutMs = 3000) =>
              new Promise<void>((ok, fail) => {
                if (predicate(text)) return ok();
                const timer = setTimeout(() => fail(new Error(`Timeout waiting for SSE data, received: ${text}`)), timeoutMs);
                waiters.push({
                  predicate,
                  resolve: () => {
                    clearTimeout(timer);
                    ok();
                  },
                });
              }),
            close: () => req.destroy(),
          };
          streams.push(stream);
          resolve(stream);
        },
      );
      req.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err);
      });
      req.end();
    });
  }

  async function ticketFor(auth: string): Promise<string> {
    const res = await t.http().post('/api/v1/admin/feed/ticket').set('authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.expiresIn).toBe(60);
    return res.body.ticket as string;
  }

  const orderEvent = (branchId: string | null, entityId: string, kind: AdminFeedEvent['kind'] = 'created'): AdminFeedEvent => ({
    branchId,
    stream: 'orders',
    kind,
    entityId,
    title: `Новый заказ ${entityId}`,
  });

  it('publishes only after commit: rolled back operations do not reach the feed', async () => {
    const branchId = await createBranch(t);
    await t.database.transaction(async () => {
      await feed().push(orderEvent(branchId, 'o1'));
      expect(await rows(sql`select * from notifications.admin_feed`)).toEqual([]);
    });
    await expect(
      t.database.transaction(async () => {
        await feed().push(orderEvent(branchId, 'o2'));
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await feed().push({ branchId: null, stream: 'bogus' as never, kind: 'created', entityId: 'x', title: 'x' });
    const stored = await rows(sql`select * from notifications.admin_feed`);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ entity_id: 'o1', stream: 'orders', kind: 'created', sound: true, branch_id: branchId, title: 'Новый заказ o1' });
  });

  it('ticket requires a queue permission; the stream rejects invalid, expired tickets and deactivated users', async () => {
    expect((await t.http().post('/api/v1/admin/feed/ticket')).status).toBe(401);
    const content = await tokenFor(t, [{ role: 'content_manager' }]);
    expect((await t.http().post('/api/v1/admin/feed/ticket').set('authorization', content.auth)).status).toBe(403);

    const bad = await t.http().get('/api/v1/admin/feed/stream').query({ ticket: 'f1.bogus.signature' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('admin_feed.invalid_ticket');
    expect((await t.http().get('/api/v1/admin/feed/stream')).status).toBe(400);

    const sysadmin = await tokenFor(t, [{ role: 'sysadmin' }]);
    const ticket = await ticketFor(sysadmin.auth);
    const [, payload, signature] = ticket.split('.');
    const forged = Buffer.from(Buffer.from(payload!, 'base64url').toString().replace('"g":"s"', '"g":"bors"')).toString('base64url');
    expect((await t.http().get('/api/v1/admin/feed/stream').query({ ticket: `f1.${forged}.${signature}` })).status).toBe(401);

    t.clock.advance(61_000);
    expect((await t.http().get('/api/v1/admin/feed/stream').query({ ticket })).status).toBe(401);

    const fresh = await ticketFor(sysadmin.auth);
    await t.get(UserRepository).updateProfile(sysadmin.userId, { isActive: false });
    expect((await t.http().get('/api/v1/admin/feed/stream').query({ ticket: fresh })).status).toBe(401);
  });

  it('stream delivers pushed events filtered by stream permission and branch', async () => {
    const branchA = await createBranch(t);
    const branchB = await createBranch(t);
    const operator = await tokenFor(t, [{ role: 'branch_operator', branchId: branchA }]);
    const stream = await openStream(await ticketFor(operator.auth));
    expect(stream.res.statusCode).toBe(200);
    expect(stream.res.headers['content-type']).toContain('text/event-stream');
    expect(stream.res.headers['cache-control']).toContain('no-cache');
    await stream.waitFor((text) => text.includes(': connected'));

    await feed().push(orderEvent(branchB, 'foreign-order'));
    await feed().push({ branchId: null, stream: 'system', kind: 'created', entityId: 'job-1', title: 'Сбой' });
    await feed().push({ branchId: branchA, stream: 'banquets', kind: 'created', entityId: 'bq-1', title: 'Банкет' });
    await t.database.transaction(async () => {
      await feed().push({ branchId: branchA, stream: 'reservations', kind: 'updated', entityId: 'r-1', title: 'Бронь изменена' });
      await feed().push(orderEvent(branchA, 'own-order'));
    });

    await stream.waitFor((text) => text.includes('own-order'));
    const events = stream.events().filter((e) => e.event === 'feed');
    expect(events.map((e) => JSON.parse(e.data).entityId)).toEqual(['r-1', 'own-order']);
    const item = JSON.parse(events[1]!.data);
    expect(item).toMatchObject({ branchId: branchA, stream: 'orders', kind: 'created', entityId: 'own-order', title: 'Новый заказ own-order', sound: true });
    expect(events[1]!.id).toBe(item.id);
    expect(JSON.parse(events[0]!.data).sound).toBe(false);
    expect(stream.received()).not.toContain('foreign-order');
    expect(stream.received()).not.toContain('job-1');

    // Системный поток и все филиалы — администратору системы и собственнику.
    const owner = await tokenFor(t, [{ role: 'owner' }]);
    const ownerStream = await openStream(await ticketFor(owner.auth));
    await ownerStream.waitFor((text) => text.includes(': connected'));
    await feed().push({ branchId: null, stream: 'system', kind: 'created', entityId: 'job-2', title: 'Сбой' });
    await feed().push(orderEvent(branchB, 'order-b'));
    await ownerStream.waitFor((text) => text.includes('order-b'));
    expect(ownerStream.events().map((e) => JSON.parse(e.data).entityId)).toEqual(['job-2', 'order-b']);
  });

  it('reconnect with Last-Event-ID replays missed events; /recent backfills by id or time', async () => {
    const branchA = await createBranch(t);
    const branchB = await createBranch(t);
    const manager = await tokenFor(t, [{ role: 'branch_manager', branchId: branchA }]);
    await feed().push(orderEvent(branchA, 'o1'));
    t.clock.advance(1000);
    await feed().push(orderEvent(branchB, 'o-foreign'));
    await feed().push({ branchId: branchA, stream: 'banquets', kind: 'created', entityId: 'bq-1', title: 'Банкет' });
    t.clock.advance(1000);
    await feed().push({ branchId: branchA, stream: 'reservations', kind: 'created', entityId: 'r1', title: 'Бронь' });
    await feed().push({ branchId: null, stream: 'system', kind: 'created', entityId: 'job-1', title: 'Сбой' });

    const recent = await t.http().get('/api/v1/admin/feed/recent').set('authorization', manager.auth);
    expect(recent.status).toBe(200);
    expect(recent.body.map((i: Row) => i.entityId)).toEqual(['o1', 'bq-1', 'r1']);
    const first = recent.body[0];
    const afterFirst = await t.http().get('/api/v1/admin/feed/recent').query({ since: first.id }).set('authorization', manager.auth);
    expect(afterFirst.body.map((i: Row) => i.entityId)).toEqual(['bq-1', 'r1']);
    const byTime = await t.http().get('/api/v1/admin/feed/recent').query({ since: first.occurredAt }).set('authorization', manager.auth);
    expect(byTime.body.map((i: Row) => i.entityId)).toEqual(['bq-1', 'r1']);
    const limited = await t.http().get('/api/v1/admin/feed/recent').query({ limit: 1 }).set('authorization', manager.auth);
    expect(limited.body.map((i: Row) => i.entityId)).toEqual(['r1']);
    expect((await t.http().get('/api/v1/admin/feed/recent').query({ since: 'yesterday' }).set('authorization', manager.auth)).status).toBe(422);
    expect((await t.http().get('/api/v1/admin/feed/recent').query({ limit: 1000 }).set('authorization', manager.auth)).status).toBe(400);
    const content = await tokenFor(t, [{ role: 'content_manager' }]);
    expect((await t.http().get('/api/v1/admin/feed/recent').set('authorization', content.auth)).status).toBe(403);

    const stream = await openStream(await ticketFor(manager.auth), { 'Last-Event-ID': first.id });
    await stream.waitFor((text) => text.includes('r1'));
    expect(stream.events().map((e) => JSON.parse(e.data).entityId)).toEqual(['bq-1', 'r1']);
  });

  it('each item carries the entity type for deep links: explicit or derived from the stream', async () => {
    const branchA = await createBranch(t);
    const owner = await tokenFor(t, [{ role: 'owner' }]);
    await feed().push(orderEvent(branchA, 'order-1'));
    await feed().push({ branchId: branchA, stream: 'reservations', kind: 'created', entityId: 'res-1', title: 'Бронь' });
    await feed().push({ branchId: branchA, stream: 'banquets', kind: 'updated', entityId: 'bq-1', title: 'Банкет' });
    await feed().push({ branchId: branchA, stream: 'orders', kind: 'updated', entityId: 'dish-1', entityType: 'dish', title: 'Стоп-лист: Плов', sound: false });
    await feed().push({ branchId: null, stream: 'system', kind: 'created', entityId: 'job-1', entityType: 'failed_job', title: 'Сбой' });
    await feed().push({ branchId: null, stream: 'system', kind: 'created', entityId: 'x-1', title: 'Без типа' });
    // Неизвестный тип — событие отбрасывается (лента не ломает бизнес-операцию).
    await feed().push({ branchId: branchA, stream: 'orders', kind: 'updated', entityId: 'bad', entityType: 'unknown' as never, title: 'X' });
    const recent = await t.http().get('/api/v1/admin/feed/recent').set('authorization', owner.auth);
    expect(recent.body.map((i: Row) => [i.entityId, i.entityType])).toEqual([
      ['order-1', 'order'],
      ['res-1', 'reservation'],
      ['bq-1', 'banquet_request'],
      ['dish-1', 'dish'],
      ['job-1', 'failed_job'],
      ['x-1', null],
    ]);
  });

  it('cleans up old feed history on schedule', async () => {
    await feed().push(orderEvent(null, 'old'));
    t.clock.advance(8 * 24 * 3600_000);
    await feed().push(orderEvent(null, 'new'));
    await t.runSchedule('notifications.feed_cleanup');
    expect((await rows(sql`select entity_id from notifications.admin_feed`)).map((r) => r.entity_id)).toEqual(['new']);
  });
});
