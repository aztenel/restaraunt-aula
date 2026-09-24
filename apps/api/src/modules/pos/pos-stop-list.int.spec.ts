import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch, tokenFor } from '../../../test/support/fixtures';
import { TestApp } from '../../../test/support/test-app';
import { IntegrationSettings } from '../../shared/infrastructure/settings/integration-settings';
import { newId } from '../../shared/kernel/ids';
import { ProductMappingRepository } from './infrastructure/product-mapping.repository';
import { createPosTestApp, kitchenOrder, ORG_ID, PosTestContext, publishAccepted, routeToIiko, TERMINAL_GROUP_ID } from './testing/pos-test-app';

const SCHEDULE = 'pos.sync_stop_lists';
const FIVE_MIN = 5 * 60_000;

function stopListBody(items: Array<{ productId: string; balance: number }>, terminalGroupId = TERMINAL_GROUP_ID) {
  return { correlationId: 'c', terminalGroupStopLists: [{ organizationId: ORG_ID, items: [{ terminalGroupId, items }] }] };
}

describe('POS: синхронизация стоп-листа (integration)', () => {
  let ctx: PosTestContext;
  let t: TestApp;

  beforeAll(async () => {
    ctx = await createPosTestApp();
    t = ctx.t;
  });
  afterAll(async () => t.close());
  beforeEach(async () => ctx.reset());

  const db = () => t.database.rootConnection();

  async function mapDish(branchId: string, dishId: string, externalProductId: string) {
    await t.get(ProductMappingRepository).insert({
      id: newId(),
      branchId,
      dishId,
      provider: 'iiko',
      externalProductId,
      externalName: null,
      modifiers: {},
      now: t.clock.now(),
    });
  }

  function stopListRequests() {
    return ctx.http.requests.filter((r) => r.url.endsWith('/api/1/stop_lists'));
  }

  async function tick(): Promise<void> {
    await t.runSchedule(SCHEDULE);
    await t.drain();
  }

  async function failedJobs(): Promise<number> {
    const rows = await sql<{ n: string }>`select count(*) as n from platform.failed_jobs`.execute(db());
    return Number(rows.rows[0]!.n);
  }

  it('syncs only branches routed to a POS with a stop-list and calls StopListControl only for changed dishes', async () => {
    const branchA = await createBranch(t);
    const branchB = await createBranch(t);
    await routeToIiko(t, { [branchA]: {} });
    const [plov, lagman, manty, combo] = [newId(), newId(), newId(), newId()];
    await mapDish(branchA, plov, 'P-1');
    await mapDish(branchA, lagman, 'P-2');
    await mapDish(branchA, manty, 'P-3');
    await mapDish(branchA, combo, 'P-1');
    ctx.http.on('/api/1/access_token', 200, { token: 'tok' });

    // 1. Первая синхронизация: в стопе P-2 — в стоп уходит только лагман.
    ctx.http.on('/api/1/stop_lists', 200, stopListBody([{ productId: 'P-2', balance: 0 }]), { times: 1 });
    await tick();
    expect(stopListRequests()).toHaveLength(1);
    expect(JSON.parse(stopListRequests()[0]!.body!)).toEqual({ organizationIds: [ORG_ID] });
    expect(stopListRequests()[0]!.headers.authorization).toBe('Bearer tok');
    expect(ctx.fakes.stopList.changes).toEqual([{ branchId: branchA, dishId: lagman, available: false, source: 'pos' }]);

    // 2. P-2 всё ещё в стопе, закончился P-1 — меняются только блюда P-1 (плов и комбо).
    t.clock.advance(FIVE_MIN);
    ctx.http.on('/api/1/stop_lists', 200, stopListBody([{ productId: 'P-1', balance: 0 }, { productId: 'P-2', balance: 0 }]), { times: 1 });
    await tick();
    expect(ctx.fakes.stopList.changes.slice(1)).toEqual([
      { branchId: branchA, dishId: plov, available: false, source: 'pos' },
      { branchId: branchA, dishId: combo, available: false, source: 'pos' },
    ]);

    // 3. P-2 вернулся (остаток > 0), P-1 в стопе — возвращается только лагман.
    t.clock.advance(FIVE_MIN);
    ctx.http.on('/api/1/stop_lists', 200, stopListBody([{ productId: 'P-1', balance: 0 }, { productId: 'P-2', balance: 5 }]), { times: 1 });
    await tick();
    expect(ctx.fakes.stopList.changes.slice(3)).toEqual([{ branchId: branchA, dishId: lagman, available: true, source: 'pos' }]);

    // 4. Ничего не изменилось — StopListControl не вызывается; позиции другой группы терминалов не учитываются.
    t.clock.advance(FIVE_MIN);
    ctx.http.on(
      '/api/1/stop_lists',
      200,
      {
        terminalGroupStopLists: [
          {
            organizationId: ORG_ID,
            items: [
              { terminalGroupId: TERMINAL_GROUP_ID, items: [{ productId: 'P-1', balance: 0 }] },
              { terminalGroupId: 'other-terminal', items: [{ productId: 'P-3', balance: 0 }] },
            ],
          },
        ],
      },
      { times: 1 },
    );
    await tick();
    expect(stopListRequests()).toHaveLength(4);
    expect(ctx.fakes.stopList.changes).toHaveLength(4);

    // Филиал B (manual) не синхронизируется.
    expect(ctx.fakes.stopList.changes.every((c) => c.branchId === branchA)).toBe(true);
    const state = await sql<any>`select * from pos.sync_state where branch_id = ${branchB}`.execute(db());
    expect(state.rows).toHaveLength(0);

    const operator = await tokenFor(t, [{ role: 'branch_operator', branchId: branchA }]);
    const status = await t.http().get(`/api/v1/admin/pos/status?branchId=${branchA}`).set('authorization', operator.auth);
    expect(status.status).toBe(200);
    expect(status.body[0].stopList).toMatchObject({ failures: 0, error: null, lastChanges: 0 });
    expect(new Date(status.body[0].stopList.syncedAt).getTime()).toBe(t.clock.now().getTime());
  });

  it('does not enqueue a second sync while one is waiting in the queue', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    await t.runSchedule(SCHEDULE);
    await t.runSchedule(SCHEDULE);
    const jobs = await sql<{ n: string }>`select count(*) as n from platform.outbox where topic = 'pos.sync_stop_list'`.execute(db());
    expect(Number(jobs.rows[0]!.n)).toBe(1);
  });

  it('one failing dish does not block the others; it is retried on the next sync', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const [plov, lagman] = [newId(), newId()];
    await mapDish(branchId, plov, 'P-1');
    await mapDish(branchId, lagman, 'P-2');
    ctx.http.on('/api/1/access_token', 200, { token: 'tok' });
    ctx.http.on('/api/1/stop_lists', 200, stopListBody([{ productId: 'P-1', balance: 0 }, { productId: 'P-2', balance: 0 }]));
    const original = ctx.fakes.stopList.setAvailability.bind(ctx.fakes.stopList);
    let failOnce = true;
    ctx.fakes.stopList.setAvailability = async (b, d, available, source) => {
      if (d === plov && failOnce) {
        failOnce = false;
        throw new Error('catalog is busy');
      }
      return original(b, d, available, source);
    };
    try {
      await tick();
      expect(ctx.fakes.stopList.changes.map((c) => c.dishId)).toEqual([lagman]);
      t.clock.advance(FIVE_MIN);
      await tick();
      expect(ctx.fakes.stopList.changes.map((c) => c.dishId)).toEqual([lagman, plov]);
    } finally {
      ctx.fakes.stopList.setAvailability = original;
    }
  });

  it('POS down: retries with a growing gap, alerts once after 3 failures, recovers; nothing in the platform failed queue', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    await mapDish(branchId, newId(), 'P-1');
    ctx.http.on('/api/1/access_token', 200, { token: 'tok' });
    ctx.http.on('/api/1/stop_lists', 503, { errorDescription: 'Maintenance' }, { times: 3 });
    ctx.http.on('/api/1/stop_lists', 200, stopListBody([]));

    // Тики каждые 5 минут в течение 30 минут: попытки на 0, 5, 15 минуте (промежутки 5, 10), следующая — через 20.
    await tick();
    for (let i = 0; i < 6; i++) {
      t.clock.advance(FIVE_MIN);
      await tick();
    }
    expect(stopListRequests()).toHaveLength(3);
    expect(ctx.fakes.notifier.staff).toHaveLength(1);
    expect(ctx.fakes.notifier.staff[0]).toMatchObject({
      template: 'staff.system_alert',
      audience: { branchId, permission: 'menu.stoplist', includeBranchChannels: true },
    });
    expect((ctx.fakes.notifier.staff[0]!.params as { details: string }).details).toContain('Maintenance');
    expect(ctx.fakes.adminFeed.events).toMatchObject([{ branchId, stream: 'system', entityId: branchId, sound: true }]);
    expect(await failedJobs()).toBe(0);

    const admin = await tokenFor(t, [{ role: 'sysadmin' }]);
    const failing = await t.http().get(`/api/v1/admin/pos/status?branchId=${branchId}`).set('authorization', admin.auth);
    expect(failing.body[0].stopList.failures).toBe(3);
    expect(failing.body[0].stopList.error).toContain('503');

    // Ручной запуск — без ожидания паузы; POS заработала — счётчик и признак оповещения сброшены.
    const manual = await t.http().post('/api/v1/admin/pos/stop-list/sync').set('authorization', admin.auth).send({ branchId });
    expect(manual.status).toBe(202);
    expect(manual.body).toMatchObject({ queued: true, alreadyQueued: false });
    await t.drain();
    expect(stopListRequests()).toHaveLength(4);
    const recovered = await t.http().get(`/api/v1/admin/pos/status?branchId=${branchId}`).set('authorization', admin.auth);
    expect(recovered.body[0].stopList).toMatchObject({ failures: 0, error: null });
    const state = await sql<any>`select stop_list_alerted_at from pos.sync_state where branch_id = ${branchId}`.execute(db());
    expect(state.rows[0].stop_list_alerted_at).toBeNull();
    expect(ctx.fakes.notifier.staff).toHaveLength(1);
  });

  it('not configured: a permanent error alerts immediately', async () => {
    const branchId = await createBranch(t);
    const other = await createBranch(t);
    await routeToIiko(t, { [other]: {} });
    await t.get(IntegrationSettings).set('pos.routing', { enabled: true, config: { default: 'manual', branches: { [branchId]: 'iiko', [other]: 'iiko' } } }, null);
    ctx.http.on('/api/1/access_token', 200, { token: 'tok' }).on('/api/1/stop_lists', 200, stopListBody([]));

    await tick();

    expect(stopListRequests()).toHaveLength(1); // только настроенный филиал
    expect(ctx.fakes.notifier.staff).toHaveLength(1);
    expect(ctx.fakes.notifier.staff[0]!.audience).toMatchObject({ branchId });
    const state = await sql<any>`select stop_list_failures, stop_list_error from pos.sync_state where branch_id = ${branchId}`.execute(db());
    expect(state.rows[0]).toMatchObject({ stop_list_failures: 1 });
    expect(state.rows[0].stop_list_error).toContain('pos.not_configured');
  });

  it('manual sync trigger: permissions, branch scoping, dedupe, unsupported provider', async () => {
    const branchA = await createBranch(t);
    const branchB = await createBranch(t);
    await routeToIiko(t, { [branchA]: {} });
    ctx.http.on('/api/1/access_token', 200, { token: 'tok' }).on('/api/1/stop_lists', 200, stopListBody([]));

    expect((await t.http().post('/api/v1/admin/pos/stop-list/sync').send({ branchId: branchA })).status).toBe(401);
    const content = await tokenFor(t, [{ role: 'content_manager' }]);
    expect((await t.http().post('/api/v1/admin/pos/stop-list/sync').set('authorization', content.auth).send({ branchId: branchA })).status).toBe(403);

    const operatorA = await tokenFor(t, [{ role: 'branch_operator', branchId: branchA }]);
    const foreign = await t.http().post('/api/v1/admin/pos/stop-list/sync').set('authorization', operatorA.auth).send({ branchId: branchB });
    expect(foreign.status).toBe(403);

    const first = await t.http().post('/api/v1/admin/pos/stop-list/sync').set('authorization', operatorA.auth).send({ branchId: branchA });
    expect(first.status).toBe(202);
    expect(first.body.alreadyQueued).toBe(false);
    const second = await t.http().post('/api/v1/admin/pos/stop-list/sync').set('authorization', operatorA.auth).send({ branchId: branchA });
    expect(second.body.alreadyQueued).toBe(true);
    await t.drain();
    expect(stopListRequests()).toHaveLength(1);

    const admin = await tokenFor(t, [{ role: 'sysadmin' }]);
    const manual = await t.http().post('/api/v1/admin/pos/stop-list/sync').set('authorization', admin.auth).send({ branchId: branchB });
    expect(manual.status).toBe(422);
    expect(manual.body.error.code).toBe('pos.stop_list_unsupported');
    const invalid = await t.http().post('/api/v1/admin/pos/stop-list/sync').set('authorization', admin.auth).send({ branchId: 'nope' });
    expect(invalid.status).toBe(400);

    const audit = await sql<{ action: string }>`select action from platform.audit_log where entity_id = ${branchA}`.execute(db());
    expect(audit.rows.map((r) => r.action)).toEqual(['pos.stop_list_sync_requested']);
  });

  it('status: provider, configuration, capabilities and failed exports per branch; scoped by permissions', async () => {
    const branchA = await createBranch(t);
    const branchB = await createBranch(t);
    await routeToIiko(t, { [branchA]: {} });
    const dish = newId();
    await mapDish(branchA, dish, 'P-1');
    ctx.http.on('/api/1/access_token', 200, { token: 'tok' }).on('/api/1/deliveries/create', 400, { errorDescription: 'Bad order' });
    const order = kitchenOrder(branchA, {
      items: [{ dishId: dish, sku: null, name: { ru: 'Плов' }, quantity: 1, modifiers: [], unitPrice: { amount: 100, currency: 'KZT' } }],
    });
    ctx.fakes.orders.orders.set(order.orderId, order);
    await publishAccepted(t, order);

    expect((await t.http().get('/api/v1/admin/pos/status')).status).toBe(401);
    const content = await tokenFor(t, [{ role: 'content_manager' }]);
    expect((await t.http().get('/api/v1/admin/pos/status').set('authorization', content.auth)).status).toBe(403);

    const admin = await tokenFor(t, [{ role: 'sysadmin' }]);
    const all = await t.http().get('/api/v1/admin/pos/status').set('authorization', admin.auth);
    expect(all.status).toBe(200);
    const a = all.body.find((s: { branchId: string }) => s.branchId === branchA);
    const b = all.body.find((s: { branchId: string }) => s.branchId === branchB);
    expect(a).toMatchObject({
      provider: 'iiko',
      providerKnown: true,
      configured: true,
      capabilities: { pushOrders: true, stopList: true, nomenclature: true },
      mappingsCount: 1,
      exports: { pending: 0, sent: 0, failed: 1, skipped: 0 },
      routingError: null,
    });
    expect(b).toMatchObject({ provider: 'manual', configured: true, capabilities: { pushOrders: false, stopList: false, nomenclature: false } });

    const operatorB = await tokenFor(t, [{ role: 'branch_operator', branchId: branchB }]);
    const own = await t.http().get('/api/v1/admin/pos/status').set('authorization', operatorB.auth);
    expect(own.body.map((s: { branchId: string }) => s.branchId)).toEqual([branchB]);
    const foreign = await t.http().get(`/api/v1/admin/pos/status?branchId=${branchA}`).set('authorization', operatorB.auth);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('access.forbidden_branch');
  });
});
