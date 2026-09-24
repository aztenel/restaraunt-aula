import ExcelJS from 'exceljs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakes, FakeHttpTransport, fakeProviders, Fakes } from '../../../test/fakes';
import { createBranch, createLegalEntity, tokenFor } from '../../../test/support/fixtures';
import { createTestApp, TestApp } from '../../../test/support/test-app';
import { EventBus } from '../../shared/infrastructure/events/event-bus';
import { HttpTransport } from '../../shared/infrastructure/integrations/external-http';
import { IntegrationCatalog } from '../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../shared/infrastructure/settings/integration-settings';
import { FileStorage } from '../../shared/infrastructure/storage/file-storage';
import { newId } from '../../shared/kernel/ids';
import { ReportingModule } from './reporting.module';
import { local, ReportingEvents, testOrder } from './testing/events';
import { globalProviders } from './testing/global-providers';

const URL_1C = 'https://1c.test/base/hs/aula/exchange';

/** Сейчас: 01.10.2026 11:00 (Asia/Almaty). */
const NOW = new Date('2026-10-01T06:00:00.000Z');

describe('Reporting: accounting export to 1C (integration)', () => {
  let t: TestApp;
  let fakes: Fakes;
  let fakeHttp: FakeHttpTransport;
  let ev: ReportingEvents;
  let branchA: string;
  let branchB: string;
  let finance: string;

  beforeAll(async () => {
    fakes = createFakes();
    fakeHttp = new FakeHttpTransport();
    const providers = [...fakeProviders(fakes), { provide: HttpTransport, useValue: fakeHttp }];
    t = await createTestApp({ imports: [globalProviders(fakeProviders(fakes)), ReportingModule], migrateModules: ['reporting'], providers });
    // ExternalHttp платформы создаётся с транспортом платформы — направляем его в FakeHttpTransport (без сети).
    vi.spyOn(t.get(HttpTransport), 'send').mockImplementation((input) => fakeHttp.send(input));
    ev = new ReportingEvents(t.get(EventBus));
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    t.clock.set(NOW);
    t.get(IntegrationSettings).invalidate();
    fakeHttp = new FakeHttpTransport();
    await createLegalEntity(t);
    branchA = await createBranch(t, { code: 'GL' });
    branchB = await createBranch(t, { code: 'GV' });
    finance = (await tokenFor(t, [{ role: 'finance' }])).auth;
  });

  async function enable1c() {
    await t
      .get(IntegrationSettings)
      .set('reporting.onec_http', { enabled: true, config: { url: URL_1C, username: 'aula' }, secrets: { password: 's3cret' } }, null);
  }

  async function seed() {
    const plov = newId();
    const order1 = testOrder(branchA, [{ dishId: plov, name: 'Плов', quantity: 2, unitPrice: 250_000 }], { deliveryFee: 50_000 });
    const order2 = testOrder(branchB, [{ dishId: plov, name: 'Плов', quantity: 1, unitPrice: 300_000 }], {
      type: 'pickup',
      paymentMethod: 'on_receipt',
    });
    await ev.orderPlaced(order1, local('2026-09-10', '12:00'));
    const pay = await ev.paymentSucceeded({ purpose: 'order', referenceId: order1.orderId, branchId: branchA, method: 'online', amount: 450_000, at: local('2026-09-10', '12:01') });
    await ev.paymentSucceeded({ purpose: 'order', referenceId: order1.orderId, branchId: branchA, method: 'gift_certificate', amount: 100_000, at: local('2026-09-10', '12:01') });
    await ev.orderCompleted(order1, local('2026-09-10', '12:00'), local('2026-09-10', '13:00'));
    await ev.orderPlaced(order2, local('2026-09-10', '18:00'), 'paid');
    await ev.orderCompleted(order2, local('2026-09-10', '18:00'), local('2026-09-10', '18:40'));
    await ev.refundSucceeded({ paymentId: pay, purpose: 'order', referenceId: order1.orderId, branchId: branchA, amount: 50_000, at: local('2026-09-11', '10:00') });
    await ev.certificateIssued({ nominal: 2_000_000, price: 2_000_000, at: local('2026-09-12', '10:00') });
    const company = { name: 'ТОО «Ромашка»', bin: '123456789012' };
    const request = await ev.banquetCreated({ branchId: branchA, at: local('2026-09-01', '10:00') });
    const invoiceId = await ev.invoiceIssued({ number: 'GL-2026-000007', requestId: request, branchId: branchA, company, amount: 4_000_000, at: local('2026-09-05', '10:00') });
    await ev.invoicePayment({ invoiceId, requestId: request, branchId: branchA, paymentId: newId(), amount: 4_000_000, paidTotal: 4_000_000, invoiceAmount: 4_000_000, at: local('2026-09-06', '10:00') });
    await ev.actIssued({ number: 'GL-2026-000003', requestId: request, branchId: branchA, company, amount: 8_000_000, vat: 857_143, at: local('2026-09-20', '10:00') });
    // За пределами периода — не попадает в выгрузку.
    const october = testOrder(branchA, [{ dishId: plov, name: 'Плов', quantity: 1, unitPrice: 100_000 }]);
    await ev.orderCompleted(october, local('2026-10-01', '09:00'), local('2026-10-01', '09:30'));
    await t.drain();
  }

  const post = (auth: string, body: Record<string, unknown>) =>
    t.http().post('/api/v1/admin/reports/accounting-exports').set('authorization', auth).send(body);
  const getExport = (auth: string, id: string) => t.http().get(`/api/v1/admin/reports/accounting-exports/${id}`).set('authorization', auth);

  it('builds well-formed EnterpriseData-like XML with expected totals and pushes it to the 1C HTTP service', async () => {
    await seed();
    await enable1c();
    fakeHttp.on('1c.test', 200, 'OK');
    const created = await post(finance, { from: '2026-09-01', to: '2026-09-30', format: 'onec_xml' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'pending', pushStatus: 'not_required', fileUrl: null, format: 'onec_xml' });
    const audit = await sql<{ action: string }>`select action from platform.audit_log where entity_id = ${created.body.id}`.execute(
      t.database.rootConnection(),
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['reporting.accounting_export_requested']);

    await t.drain();
    const res = await getExport(finance, created.body.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ready',
      pushStatus: 'pushed',
      pushAttempts: 1,
      fileName: 'aula_accounting_2026-09-01_2026-09-30.xml',
      totals: {
        retailSales: { amount: 850_000 },
        refunds: { amount: 50_000 },
        certificateSales: { amount: 2_000_000 },
        invoices: { amount: 4_000_000 },
        acts: { amount: 8_000_000 },
        retailDocuments: 3,
        invoiceCount: 1,
        actCount: 1,
      },
    });
    expect(res.body.fileUrl).toContain('/files/private?');

    const xml = (await t.get(FileStorage).get(`accounting-exports/${created.body.id}.xml`, 'private')).toString('utf8');
    expect(XMLValidator.validate(xml)).toBe(true);
    const doc = new XMLParser({ ignoreAttributes: false, parseTagValue: false, isArray: (name) => ['Строка'].includes(name) || name.startsWith('Документ.') || name.startsWith('Справочник.') }).parse(xml);
    const body = doc.Message.Body;
    expect(body['@_xmlns']).toBe('http://v8.1c.ru/edi/edi_stnd/EnterpriseData/1.8');
    expect(doc.Message['msg:Header']['msg:Format']).toBe('http://v8.1c.ru/edi/edi_stnd/EnterpriseData/1.8');
    const retail = body['Документ.ОтчетОРозничныхПродажах'];
    expect(retail).toHaveLength(3);
    const gl = retail.find((d: any) => d.Склад.Код === 'GL' && d.КлючевыеСвойства.Дата.startsWith('2026-09-10'));
    expect(gl).toMatchObject({ СуммаДокумента: '5500.00', КоличествоЧеков: '1', Валюта: 'KZT' });
    expect(gl.Товары.Строка[0]).toMatchObject({ Количество: '2', Цена: '2500.00', Сумма: '5000.00' });
    expect(gl.Услуги.Строка[0]).toMatchObject({ Содержание: 'Доставка', Сумма: '500.00' });
    expect(gl.Оплаты.Строка.map((p: any) => [p.Код, p.Сумма])).toEqual([
      ['online', '4500.00'],
      ['gift_certificate', '1000.00'],
    ]);
    expect(gl.КлючевыеСвойства.Организация.Наименование).toBe('ТОО «Express kitchen»');
    const gv = retail.find((d: any) => d.Склад.Код === 'GV');
    expect(gv.Оплаты.Строка).toEqual([{ ВидОплаты: 'ОплатаПриПолучении', Код: 'on_receipt', Сумма: '3000.00' }]);
    const refundDay = retail.find((d: any) => d.КлючевыеСвойства.Дата.startsWith('2026-09-11'));
    expect(refundDay).toMatchObject({ СуммаВозвратов: '500.00', СуммаДокумента: '0.00' });
    const total = retail.reduce((a: number, d: any) => a + Math.round(Number(d.СуммаДокумента) * 100), 0);
    expect(total).toBe(850_000);

    expect(body['Справочник.Контрагенты']).toHaveLength(1);
    expect(body['Справочник.Контрагенты'][0].КлючевыеСвойства).toMatchObject({ Наименование: 'ТОО «Ромашка»', БИН: '123456789012' });
    expect(body['Документ.СчетНаОплатуПокупателю'][0]).toMatchObject({ СуммаДокумента: '40000.00', Оплачено: '40000.00' });
    expect(body['Документ.СчетНаОплатуПокупателю'][0].КлючевыеСвойства.Номер).toBe('GL-2026-000007');
    expect(body['Документ.РеализацияТоваровУслуг'][0]).toMatchObject({ СуммаДокумента: '80000.00', СуммаНДС: '8571.43' });
    expect(body['Документ.ПродажаПодарочныхСертификатов'][0]).toMatchObject({ СуммаДокумента: '20000.00', Количество: '1' });

    expect(fakeHttp.requests).toHaveLength(1);
    const request = fakeHttp.requests[0]!;
    expect(request).toMatchObject({ method: 'POST', url: URL_1C });
    expect(request.headers.authorization).toBe(`Basic ${Buffer.from('aula:s3cret').toString('base64')}`);
    expect(request.headers['x-aula-export-id']).toBe(created.body.id);
    expect(request.body).toContain('<Message');
    // Полный лог обмена — с маскированием секретов.
    const logs = await sql<{ request: any }>`select request from platform.integration_logs where integration = 'reporting.onec_http'`.execute(
      t.database.rootConnection(),
    );
    expect(logs.rows[0]!.request.headers.authorization).not.toContain('s3cret');
    expect(t.get(IntegrationCatalog).get('reporting.onec_http')).toMatchObject({ category: 'accounting', stage: 3 });
  });

  it('retries the push on 5xx with backoff, fails on 4xx and can be pushed again manually', async () => {
    await seed();
    await enable1c();
    fakeHttp.on('1c.test', 503, 'busy', { times: 1 }).on('1c.test', 200, 'OK', { times: 1 });
    const created = await post(finance, { from: '2026-09-01', to: '2026-09-30', format: 'onec_xml' });
    await t.drain();
    expect((await getExport(finance, created.body.id)).body).toMatchObject({ status: 'ready', pushStatus: 'pending', pushAttempts: 1 });
    t.clock.advance(61_000);
    await t.drain();
    expect((await getExport(finance, created.body.id)).body).toMatchObject({ pushStatus: 'pushed', pushAttempts: 2 });

    fakeHttp.on('1c.test', 401, 'unauthorized', { times: 1 });
    const second = await post(finance, { from: '2026-09-01', to: '2026-09-30', format: 'onec_xml', branchId: branchA });
    await t.drain();
    const failed = await getExport(finance, second.body.id);
    expect(failed.body).toMatchObject({ status: 'ready', pushStatus: 'failed', pushAttempts: 1 });
    expect(failed.body.pushError).toContain('HTTP 401');

    fakeHttp.on('1c.test', 200, 'OK', { times: 1 });
    const retried = await t.http().post(`/api/v1/admin/reports/accounting-exports/${second.body.id}/push`).set('authorization', finance);
    expect(retried.status).toBe(201);
    expect(retried.body.pushStatus).toBe('pending');
    await t.drain();
    expect((await getExport(finance, second.body.id)).body.pushStatus).toBe('pushed');
    const audit = await sql<{ action: string }>`select action from platform.audit_log where entity_id = ${second.body.id} order by occurred_at`.execute(
      t.database.rootConnection(),
    );
    expect(audit.rows.map((r) => r.action)).toContain('reporting.accounting_export_push_requested');
  });

  it('xlsx format, validation and access control', async () => {
    await seed();
    const created = await post(finance, { from: '2026-09-01', to: '2026-09-30', format: 'xlsx', branchId: branchA });
    expect(created.status).toBe(201);
    await t.drain();
    const res = await getExport(finance, created.body.id);
    expect(res.body).toMatchObject({ status: 'ready', pushStatus: 'not_required', fileName: 'aula_accounting_GL_2026-09-01_2026-09-30.xlsx' });
    expect(res.body.totals.retailSales.amount).toBe(550_000);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await t.get(FileStorage).get(`accounting-exports/${created.body.id}.xlsx`, 'private')) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Розничные продажи', 'Позиции', 'Сертификаты', 'Счета', 'Акты']);
    expect(wb.getWorksheet('Розничные продажи')!.getRow(2).getCell(5).value).toBe(5500);
    expect(wb.getWorksheet('Счета')!.getRow(2).getCell(3).value).toBe('ТОО «Ромашка»');

    // Отправка XLSX в 1С недоступна; без настройки интеграции — отказ.
    const pushXlsx = await t.http().post(`/api/v1/admin/reports/accounting-exports/${created.body.id}/push`).set('authorization', finance);
    expect(pushXlsx.status).toBe(409);
    expect(pushXlsx.body.error.code).toBe('accounting_export.push_not_configured');
    await enable1c();
    const pushXlsx2 = await t.http().post(`/api/v1/admin/reports/accounting-exports/${created.body.id}/push`).set('authorization', finance);
    expect(pushXlsx2.body.error.code).toBe('accounting_export.push_not_available');

    expect((await post(finance, { from: '2026-09-01', to: '2026-09-30', format: 'csv' })).status).toBe(400);
    const reversed = await post(finance, { from: '2026-09-30', to: '2026-09-01', format: 'xlsx' });
    expect(reversed.status).toBe(422);
    expect(reversed.body.error.code).toBe('report.invalid_period');

    const manager = (await tokenFor(t, [{ role: 'branch_manager', branchId: branchA }])).auth;
    expect((await post(manager, { from: '2026-09-01', to: '2026-09-30', format: 'xlsx', branchId: branchA })).status).toBe(403);
    expect((await getExport(manager, created.body.id)).status).toBe(403);
    expect((await getExport(finance, newId())).status).toBe(404);

    const list = await t.http().get('/api/v1/admin/reports/accounting-exports').set('authorization', finance);
    expect(list.body).toMatchObject({ total: 1, page: 1 });
    expect(list.body.items[0].id).toBe(created.body.id);
  });
});
