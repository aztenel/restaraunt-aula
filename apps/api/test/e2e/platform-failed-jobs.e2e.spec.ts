import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, createE2eApp, deliveries, E2eContext, failedJobs, feed, pendingOutbox } from './support/e2e-app';

/**
 * Сценарий 9: внешний вызов в фоновой задаче упорно падает → повторы с экспоненциальной задержкой →
 * очередь неудач (platform.failed_jobs) → событие platform.job_failed → Notifications: staff.system_alert
 * администраторам и событие системной ленты админки. Повтор из админки выполняет задачу заново.
 * Задача — импорт номенклатуры POS (iiko, сеть подменена): 4 попытки, затем очередь неудач.
 */
describe('E2E 9: failed job → failed_jobs → system alert → retry', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await ctx.reset();
  });

  it('POS nomenclature import keeps failing (HTTP 503) → failed job + staff.system_alert + system feed; admin retry succeeds', async () => {
    const { greenline } = ctx.seed.branches;
    const admin = await ctx.staff([{ role: 'sysadmin' }], 'Администратор (дежурный)', { phone: '+77010000999' });
    const operator = await ctx.staff([{ role: 'branch_operator', branchId: greenline }], 'Оператор GL');
    // Филиал GreenLine переводится на iiko (настройки интеграций — через админ-API).
    await ctx.configureIntegration('pos.iiko', {
      enabled: true,
      config: { baseUrl: 'https://iiko.test', branches: { [greenline]: { organizationId: 'org-gl', terminalGroupId: 'tg-gl' } } },
      secrets: { apiLogin: 'iiko-api-login-secret' },
    });
    await ctx.configureIntegration('pos.routing', { enabled: true, config: { default: 'manual', branches: { [greenline]: 'iiko' } } });
    ctx.net.on('access_token', 503, 'Service Unavailable', { times: 4 });
    ctx.net.on('access_token', 200, { correlationId: 'c1', token: 'iiko-token-1' });
    ctx.net.on('nomenclature', 200, {
      groups: [{ id: 'g1', name: 'Горячее' }],
      products: [
        { id: 'p-plov', name: 'Плов', code: 'AULA-402', type: 'Dish', parentGroup: 'g1' },
        { id: 'p-lagman', name: 'Лагман', code: 'AULA-401', type: 'Dish', parentGroup: 'g1' },
      ],
    });

    const queued = await ctx.api().post('/api/v1/admin/pos/products/import').set('Authorization', admin.auth).send({ branchId: greenline }).expect(202);
    expect(queued.body).toMatchObject({ queued: true, alreadyQueued: false });

    // Попытки: сразу, через 30 с, 60 с, 120 с (экспоненциальная задержка), затем — очередь неудач.
    await ctx.drain();
    expect(await failedJobs(ctx)).toEqual([]);
    for (const delay of [30_000, 60_000]) await ctx.drain(delay);
    expect(await failedJobs(ctx)).toEqual([]);
    await ctx.drain(120_000);
    expect(ctx.net.requests.filter((r) => r.url.includes('access_token'))).toHaveLength(4);
    expect(await pendingOutbox(ctx)).toEqual([]);

    const [failed] = await failedJobs(ctx);
    expect(failed).toMatchObject({
      kind: 'job',
      topic: 'pos.import_products',
      handler: 'PosJobsHandler.onImportProducts',
      attempts: 4,
      payload: { branchId: greenline },
      resolvedAt: null,
    });
    expect(failed.error).toContain('HTTP 503');

    // Оповещение администраторам (право system.jobs) и событие системной ленты со звуком.
    const alerts = await deliveries(ctx, { template: 'staff.system_alert', relatedId: failed.id });
    expect(alerts).toEqual([expect.objectContaining({ recipientName: 'Администратор (дежурный)', audience: 'staff', status: 'sent' })]);
    const systemFeed = (await feed(ctx, admin.auth)).filter((f) => f.stream === 'system');
    expect(systemFeed).toEqual([expect.objectContaining({ kind: 'created', entityId: failed.id, sound: true, title: expect.stringContaining('pos.import_products') })]);
    // Оператор точки системных событий не видит (нет права system.jobs).
    expect((await feed(ctx, operator.auth)).some((f) => f.stream === 'system')).toBe(false);
    // Состояние POS филиала показывает ошибку импорта; журнал интеграций — ответы 503 без секретов.
    const status = await ctx.api().get('/api/v1/admin/pos/status').query({ branchId: greenline }).set('Authorization', admin.auth).expect(200);
    expect(status.body[0]).toMatchObject({ provider: 'iiko', products: { error: expect.stringContaining('503') } });
    const logs = await ctx.api().get('/api/v1/admin/system/integration-logs').query({ integration: 'pos.iiko' }).set('Authorization', admin.auth).expect(200);
    expect(logs.body.items.length).toBe(4);
    expect(JSON.stringify(logs.body.items)).not.toContain('iiko-api-login-secret');

    // Без права system.jobs очередь неудач недоступна.
    await ctx.api().get('/api/v1/admin/system/failed-jobs').set('Authorization', operator.auth).expect(403);

    // ---------------------------------------------------------------- Повтор из админки: POS снова доступна
    await ctx.api().post(`/api/v1/admin/system/failed-jobs/${failed.id}/retry`).set('Authorization', admin.auth).expect(204);
    await ctx.drain();
    expect(await failedJobs(ctx)).toEqual([]); // закрыта
    const all = await ctx.api().get('/api/v1/admin/system/failed-jobs').query({ open: 'false' }).set('Authorization', admin.auth).expect(200);
    expect(all.body.items).toEqual([expect.objectContaining({ id: failed.id, retriedAt: expect.any(String), resolvedAt: expect.any(String) })]);
    const products = await ctx.api().get('/api/v1/admin/pos/products').query({ branchId: greenline }).set('Authorization', admin.auth).expect(200);
    expect(products.body.items.map((p: any) => [p.externalProductId, p.sku]).sort()).toEqual([
      ['p-lagman', 'AULA-401'],
      ['p-plov', 'AULA-402'],
    ]);
    const statusAfter = await ctx.api().get('/api/v1/admin/pos/status').query({ branchId: greenline }).set('Authorization', admin.auth).expect(200);
    expect(statusAfter.body[0].products).toMatchObject({ error: null, count: 2 });
    expect((await auditLog(ctx, { entityId: failed.id })).map((a) => [a.action, a.actorUserId])).toEqual([['system.failed_job_retried', admin.userId]]);
  });
});
