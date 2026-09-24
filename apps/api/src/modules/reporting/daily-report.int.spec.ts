import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakes, fakeProviders, Fakes } from '../../../test/fakes';
import { createBranch, createStaff, tokenFor } from '../../../test/support/fixtures';
import { createTestApp, TestApp } from '../../../test/support/test-app';
import { EventBus } from '../../shared/infrastructure/events/event-bus';
import { FileStorage } from '../../shared/infrastructure/storage/file-storage';
import { newId } from '../../shared/kernel/ids';
import { ReportingModule } from './reporting.module';
import { local, ReportingEvents, testOrder } from './testing/events';
import { globalProviders } from './testing/global-providers';

async function workbook(body: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as unknown as ArrayBuffer);
  return wb;
}

function binary(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('Reporting: daily report (integration)', () => {
  let t: TestApp;
  let fakes: Fakes;
  let ev: ReportingEvents;
  let branchA: string;
  let branchB: string;
  let managerA: string;

  beforeAll(async () => {
    fakes = createFakes();
    const providers = fakeProviders(fakes);
    t = await createTestApp({ imports: [globalProviders(providers), ReportingModule], migrateModules: ['reporting'], providers });
    ev = new ReportingEvents(t.get(EventBus));
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    fakes.notifier.clear();
    branchA = await createBranch(t, { code: 'GL' });
    branchB = await createBranch(t, { code: 'GV' });
    await createStaff(t, [{ role: 'owner' }], 'Собственник');
    managerA = await createStaff(t, [{ role: 'branch_manager', branchId: branchA }], 'Управляющий GL');

    const order = testOrder(branchA, [{ dishId: newId(), name: 'Плов', quantity: 2, unitPrice: 250_000 }]);
    await ev.orderPlaced(order, local('2026-10-01', '12:00'));
    await ev.orderCompleted(order, local('2026-10-01', '12:00'), local('2026-10-01', '13:00'));
    await ev.certificateIssued({ nominal: 1_000_000, price: 1_000_000, at: local('2026-10-01', '15:00') });
    await ev.banquetCreated({ branchId: branchB, at: local('2026-10-01', '16:00') });
    await t.drain();
  });

  it('runs at 23:30: stores per-branch and consolidated reports with XLSX and notifies owners and branch managers once', async () => {
    t.clock.set(local('2026-10-01', '23:30'));
    await t.runSchedule('reporting.daily_report');

    const rows = await sql<{ scope: string; file_key: string; notified_at: Date | null }>`
      select scope, file_key, notified_at from reporting.daily_reports where report_date = '2026-10-01' order by scope`.execute(
      t.database.rootConnection(),
    );
    expect(rows.rows.map((r) => r.scope).sort()).toEqual(['all', branchA, branchB].sort());

    // Сводный — собственнику и финансам (reports.consolidated); филиальный — управляющему филиала.
    expect(fakes.notifier.staff).toHaveLength(2);
    const consolidated = fakes.notifier.staff.find((s) => (s.audience as any).permission === 'reports.consolidated')!;
    expect(consolidated.template).toBe('staff.daily_report');
    expect(consolidated.audience).toEqual({ branchId: null, permission: 'reports.consolidated' });
    expect(consolidated.params).toMatchObject({ date: '01.10.2026' });
    expect((consolidated.params as any).summary).toContain('выручка 15 000 ₸');
    expect((consolidated.params as any).adminUrl).toContain('/reports/daily?date=2026-10-01');
    const branch = fakes.notifier.staff.find((s) => (s.audience as any).branchId === branchA)!;
    expect(branch.audience).toEqual({ branchId: branchA, userIds: [managerA] });
    expect((branch.params as any).summary).toContain('выручка 5 000 ₸');
    // У филиала B нет управляющего — отчёт сохранён, уведомлять некого.
    expect(rows.rows.find((r) => r.scope === branchB)!.notified_at).toBeNull();

    const stored = await t.get(FileStorage).get('reports/daily/2026-10-01/all.xlsx', 'private');
    const wb = await workbook(stored);
    const summary = wb.getWorksheet('Сводка')!;
    expect(summary.getRow(2).getCell(1).value).toBe('Выручка, итого');
    expect(summary.getRow(2).getCell(4).value).toBe(15_000);

    // Повторный запуск (или задержка после полуночи) не дублирует уведомления.
    t.clock.set(local('2026-10-02', '00:20'));
    await t.runSchedule('reporting.daily_report');
    expect(fakes.notifier.staff).toHaveLength(2);
    const count = await sql<{ n: number }>`select count(*)::int as n from reporting.daily_reports`.execute(t.database.rootConnection());
    expect(count.rows[0]!.n).toBe(3);
  });

  it('GET /admin/reports/daily returns the stored report (or live data before 23:30) with scoping', async () => {
    const owner = (await tokenFor(t, [{ role: 'owner' }])).auth;
    const manager = (await tokenFor(t, [{ role: 'branch_manager', branchId: branchA }])).auth;

    const live = await t.http().get('/api/v1/admin/reports/daily?date=2026-10-01').set('authorization', owner);
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ id: null, isFinal: false, fileUrl: null, date: '2026-10-01', branchId: null });
    expect(live.body.summary.revenue.total.amount).toBe(1_500_000);

    t.clock.set(local('2026-10-01', '23:30'));
    await t.runSchedule('reporting.daily_report');

    const res = await t.http().get('/api/v1/admin/reports/daily?date=2026-10-01').set('authorization', owner);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isFinal: true, date: '2026-10-01', branchId: null });
    expect(res.body.id).toBeTruthy();
    expect(res.body.fileUrl).toContain('/files/private?');
    expect(res.body.summary).toMatchObject({
      revenue: { total: { amount: 1_500_000, currency: 'KZT' }, certificate: { amount: 1_000_000 } },
      orders: { completed: 1, placed: 1, averageCheck: { amount: 500_000 } },
      banquets: { newRequests: 1 },
    });
    expect(res.body.summary.topDishes[0].name.ru).toBe('Плов');

    const own = await t.http().get(`/api/v1/admin/reports/daily?date=2026-10-01&branchId=${branchA}`).set('authorization', manager);
    expect(own.status).toBe(200);
    expect(own.body.summary.revenue.total.amount).toBe(500_000);
    expect((await t.http().get('/api/v1/admin/reports/daily?date=2026-10-01').set('authorization', manager)).status).toBe(403);
    expect((await t.http().get(`/api/v1/admin/reports/daily?branchId=${branchB}`).set('authorization', manager)).status).toBe(403);
    expect((await t.http().get('/api/v1/admin/reports/daily?date=01.10.2026').set('authorization', owner)).status).toBe(400);

    const file = await t.http().get('/api/v1/admin/reports/daily/export?date=2026-10-01').set('authorization', owner).buffer(true).parse(binary);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toContain('aula_daily_2026-10-01_all.xlsx');
    expect((await workbook(file.body)).getWorksheet('Топ блюд')!.getRow(2).getCell(1).value).toBe('Плов');

    const history = await t.http().get('/api/v1/admin/reports/daily/history?from=2026-10-01&to=2026-10-01').set('authorization', owner);
    expect(history.body).toMatchObject({ total: 3, page: 1 });
    const managerHistory = await t
      .http()
      .get(`/api/v1/admin/reports/daily/history?from=2026-10-01&to=2026-10-01&branchId=${branchA}`)
      .set('authorization', manager);
    expect(managerHistory.body.total).toBe(1);
    expect(managerHistory.body.items[0].branchId).toBe(branchA);

    // Цели ТЗ: дневной отчёт сформирован автоматически за завершённые дни.
    t.clock.set(local('2026-10-02', '12:00'));
    const goals = await t.http().get('/api/v1/admin/reports/goals?from=2026-10-01&to=2026-10-01').set('authorization', owner);
    expect(goals.body).toMatchObject({ dailyReportsExpected: 1, dailyReportsGenerated: 1 });
  });
});
