import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/shared/infrastructure/database/database';
import { IS_PUBLIC_KEY } from '../../src/shared/infrastructure/http/decorators';
import { RATE_LIMIT_KEY, SKIP_RATE_LIMIT_KEY } from '../../src/shared/infrastructure/rate-limit/rate-limit.guard';
import { buildOpenApiDocument } from '../../src/shared/infrastructure/http/swagger';
import { createE2eApp, E2eContext, idem } from './support/e2e-app';
import { placeOrder, storefrontMenu } from './support/ordering';

interface Route {
  method: string;
  path: string;
  controller: string;
  handler: string;
  isPublic: boolean;
  rateLimits: string[];
  skipRateLimit: boolean;
}

const METHODS: Record<number, string> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
};

/** Публичные маршруты под /admin: вход/обновление/выход и поток ленты (проверяет свой билет). */
const PUBLIC_ADMIN_ROUTES = new Set([
  'post /api/v1/admin/auth/login',
  'post /api/v1/admin/auth/refresh',
  'post /api/v1/admin/auth/logout',
  'get /api/v1/admin/feed/stream',
]);

/**
 * Сценарий 10: безопасность и НФТ — лимиты частоты на публичных формах, админка закрыта по умолчанию
 * (маршруты перечисляются из роутера Nest, а не из списка вручную), нет случайных @Public в админке,
 * физическое удаление заказов, платежей и броней запрещено триггерами БД, журнал действий — только добавление.
 */
describe('E2E 10: security / NFR smoke', () => {
  let ctx: E2eContext;
  let routes: Route[];

  beforeAll(async () => {
    ctx = await createE2eApp();
    const reflector = ctx.t.get(Reflector);
    routes = [];
    for (const wrapper of ctx.t.get(DiscoveryService).getControllers()) {
      const type = wrapper.metatype as (new (...args: any[]) => unknown) | undefined;
      if (!type) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, type) ?? '');
      for (const name of Object.getOwnPropertyNames(type.prototype)) {
        const fn = type.prototype[name];
        if (typeof fn !== 'function' || name === 'constructor') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, fn);
        const sub = Reflect.getMetadata(PATH_METADATA, fn);
        if (method === undefined || sub === undefined) continue;
        for (const p of Array.isArray(sub) ? sub : [sub]) {
          const path = `/api/v1/${[base, p].map((x) => String(x).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`;
          routes.push({
            method: METHODS[method as number] ?? String(method),
            path,
            controller: type.name,
            handler: name,
            isPublic: reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [fn, type]) ?? false,
            rateLimits: reflector.getAllAndOverride<string[]>(RATE_LIMIT_KEY, [fn, type]) ?? [],
            skipRateLimit: reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [fn, type]) ?? false,
          });
        }
      }
    }
  });
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await ctx.reset();
  });

  it('the router exposes the expected surface', () => {
    const admin = routes.filter((r) => r.path.startsWith('/api/v1/admin/'));
    expect(admin.length).toBeGreaterThan(200);
    expect(routes.filter((r) => r.path.startsWith('/api/v1/public/')).length).toBeGreaterThan(40);
  });

  it('no admin route is @Public except login/refresh/logout and the feed stream (which checks its ticket)', () => {
    const publicAdmin = routes.filter((r) => r.path.startsWith('/api/v1/admin/') && r.isPublic).map((r) => `${r.method} ${r.path}`);
    expect(publicAdmin.sort()).toEqual([...PUBLIC_ADMIN_ROUTES].sort());
    // Всё публичное — только витрина, вебхуки, служебные маршруты и перечисленные выше.
    const unexpected = routes
      .filter((r) => r.isPublic)
      .filter((r) => !/^\/api\/v1\/(public|webhooks|files|health|metrics)(\/|$)/.test(r.path) && !PUBLIC_ADMIN_ROUTES.has(`${r.method} ${r.path}`))
      .map((r) => `${r.method} ${r.path}`);
    expect(unexpected).toEqual([]);
    // И наоборот: витрина не требует входа сотрудника.
    const closedPublic = routes.filter((r) => /^\/api\/v1\/(public|webhooks)\//.test(r.path) && !r.isPublic).map((r) => `${r.method} ${r.path}`);
    expect(closedPublic).toEqual([]);
  });

  it('every admin route answers 401 without a token (enumerated from the Nest router)', async () => {
    const uuid = '0190f0a0-0000-7000-8000-000000000001';
    const failures: string[] = [];
    for (const r of routes.filter((x) => x.path.startsWith('/api/v1/admin/') && !PUBLIC_ADMIN_ROUTES.has(`${x.method} ${x.path}`))) {
      const url = r.path.replace(/:[A-Za-z]+/g, uuid);
      const req = (ctx.api() as any)[r.method](url);
      const res = r.method === 'get' || r.method === 'delete' ? await req : await req.send({});
      if (res.status !== 401) failures.push(`${r.method.toUpperCase()} ${r.path} → ${res.status}`);
      else expect(res.body.error.code).toBe('auth.unauthenticated');
    }
    expect(failures).toEqual([]);
    // Поддельный токен — тоже 401; поток ленты без билета/с чужим билетом не открывается.
    await ctx.api().get('/api/v1/admin/orders').set('Authorization', 'Bearer not-a-jwt').expect(401);
    const noTicket = await ctx.api().get('/api/v1/admin/feed/stream');
    expect([400, 401, 422]).toContain(noTicket.status);
    await ctx.api().get('/api/v1/admin/feed/stream').query({ ticket: 'forged-ticket-0123456789' }).expect(401);
  }, 120_000);

  it('the OpenAPI document marks every protected admin operation with bearer security', () => {
    const doc = buildOpenApiDocument(ctx.t.app, 'test');
    const insecure: string[] = [];
    for (const [path, ops] of Object.entries(doc.paths)) {
      if (!path.startsWith('/api/v1/admin/')) continue;
      for (const [method, op] of Object.entries(ops as Record<string, any>)) {
        if (PUBLIC_ADMIN_ROUTES.has(`${method} ${path.replace(/\{([^}]+)\}/g, ':$1')}`)) continue;
        if (!(op.security ?? []).some((s: Record<string, unknown>) => 'staff' in s)) insecure.push(`${method} ${path}`);
      }
    }
    expect(insecure).toEqual([]);
  });

  it('staff without the permission gets 403 (permissions are checked per route and per branch)', async () => {
    const content = await ctx.staff([{ role: 'content_manager' }]);
    for (const url of ['/api/v1/admin/orders', '/api/v1/admin/payments', '/api/v1/admin/system/audit-log', '/api/v1/admin/reports/revenue', '/api/v1/admin/customers']) {
      const res = await ctx.api().get(url).set('Authorization', content.auth);
      expect(res.status, url).toBe(403);
      expect(res.body.error.code).toBe('access.forbidden');
    }
    await ctx.api().get('/api/v1/admin/catalog/dishes').set('Authorization', content.auth).expect(200);
  });

  it('public write endpoints are rate limited; webhooks are not', () => {
    const unlimited = routes
      .filter((r) => r.isPublic && r.method !== 'get' && r.path.startsWith('/api/v1/public/') && r.rateLimits.length === 0)
      .map((r) => `${r.method} ${r.path}`);
    expect(unlimited).toEqual([]);
    const webhooks = routes.filter((r) => r.path.startsWith('/api/v1/webhooks/') && r.method === 'post');
    expect(webhooks.length).toBeGreaterThan(0);
    expect(webhooks.every((r) => r.skipRateLimit)).toBe(true);
  });

  it('form endpoints answer 429 after the limit (per route and IP), with Retry-After', async () => {
    const cases: Array<{ url: string; limit: number; body: unknown }> = [
      { url: '/api/v1/public/orders', limit: 20, body: {} },
      { url: '/api/v1/public/reservations', limit: 20, body: {} },
      { url: '/api/v1/public/banquets/requests', limit: 20, body: {} },
      { url: '/api/v1/public/certificates/purchase', limit: 20, body: {} },
      { url: '/api/v1/public/phone-verifications', limit: 5, body: {} },
      { url: '/api/v1/public/certificates/check', limit: 10, body: { code: 'AAAA-BBBB-CCCC' } },
      { url: '/api/v1/admin/auth/login', limit: 10, body: { email: 'nobody@aula.kz', password: 'wrong-password-1' } },
    ];
    for (const c of cases) {
      for (let i = 0; i < c.limit; i++) {
        const res = await ctx.api().post(c.url).send(c.body as object);
        expect(res.status, `${c.url} #${i + 1}`).not.toBe(429);
      }
      const limited = await ctx.api().post(c.url).send(c.body as object);
      expect(limited.status, c.url).toBe(429);
      expect(limited.body.error.code).toBe('rate_limit.exceeded');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    }
    // Лимит считается по маршруту: соседняя форма и витрина (чтение) доступны.
    await ctx.api().get('/api/v1/public/branches').expect(200);
    const quote = await ctx.api().post('/api/v1/public/orders/quote').send({});
    expect(quote.status).not.toBe(429);
    // Вебхуки провайдеров не ограничиваются (частоту контролирует провайдер): неверная подпись — 403, не 429.
    for (let i = 0; i < 25; i++) {
      const res = await ctx.api().post('/api/v1/webhooks/payments/sandbox').set('x-sandbox-signature', 'bad').send({ eventId: `e${i}` });
      expect(res.status).toBe(403);
    }
  }, 120_000);

  it('physical DELETE of orders, payments and reservations is rejected by DB triggers; audit log is append-only', async () => {
    const { greenline } = ctx.seed.branches;
    const menu = await storefrontMenu(ctx, 'greenline');
    const order = await placeOrder(ctx, { branchId: greenline, type: 'pickup', items: [{ dishId: menu.get('plov')!.id, quantity: 1 }], paymentMethod: 'online' });
    const free = await ctx.api().get('/api/v1/public/branches/greenline/reservation-availability').query({ date: '2026-10-02', time: '19:00', guests: 2, typeCode: 'table' }).expect(200);
    await ctx
      .api()
      .post('/api/v1/public/reservations')
      .send({
        branchId: greenline,
        venueId: free.body.venues[0].venueId,
        date: '2026-10-02',
        time: '19:00',
        guests: 2,
        customer: { name: 'Гость', phone: '+77015550000' },
        consent: { personalData: true },
        locale: 'ru',
        idempotencyKey: idem('resv'),
      })
      .expect(201);
    await ctx.drain();

    const db = ctx.t.get(Database).rootConnection();
    const count = async (table: string) => Number((await sql<{ n: number }>`select count(*)::int as n from ${sql.raw(table)}`.execute(db)).rows[0]!.n);
    for (const table of ['ordering.orders', 'ordering.order_items', 'payments.payments', 'reservation.reservations']) {
      const before = await count(table);
      expect(before, table).toBeGreaterThan(0);
      await expect(sql`delete from ${sql.raw(table)}`.execute(db), table).rejects.toThrow(/Physical delete is forbidden/);
      expect(await count(table)).toBe(before);
    }
    const auditBefore = await count('platform.audit_log');
    expect(auditBefore).toBeGreaterThan(0);
    await expect(sql`update platform.audit_log set action = 'tampered'`.execute(db)).rejects.toThrow();
    await expect(sql`delete from platform.audit_log`.execute(db)).rejects.toThrow();
    expect(await count('platform.audit_log')).toBe(auditBefore);

    // В API нет маршрутов физического удаления заказов, платежей и броней.
    const deletes = routes.filter((r) => r.method === 'delete' && /^\/api\/v1\/admin\/(orders|payments|reservations)(\/|$)/.test(r.path));
    expect(deletes).toEqual([]);
    expect(order.orderId).toBeTruthy();
  });
});
