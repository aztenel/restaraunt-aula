import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IntegrationSettings } from '../../shared/infrastructure/settings/integration-settings';
import { api, BanquetTestContext, banquetWorld, BanquetWorld, createBanquetTestApp, publicRequestBody, resetBanquet } from './testing/banquet-test-kit';

const SOAP = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
const SESSION = SOAP('<ns2:createSessionResponse xmlns:ns2="esf"><sessionId>SESSION-1</sessionId></ns2:createSessionResponse>');
const ACCEPTED = SOAP('<ns2:syncInvoiceResponse xmlns:ns2="esf"><acceptedSet><invoice><id>555</id><num>x</num></invoice></acceptedSet></ns2:syncInvoiceResponse>');
const DECLINED = SOAP(
  '<ns2:syncInvoiceResponse xmlns:ns2="esf"><declinedSet><invoice><errors><error><errorCode>CUSTOMER_TIN_INVALID</errorCode><text>Неверный БИН покупателя</text></error></errors></invoice></declinedSet></ns2:syncInvoiceResponse>',
);
const REGISTERED = SOAP(
  '<ns2:queryInvoiceResponse xmlns:ns2="esf"><invoiceInfoList><invoiceInfo><invoiceId>555</invoiceId><invoiceStatus>DELIVERED</invoiceStatus><registrationNumber>ESF-940140001234-20261115-0001</registrationNumber></invoiceInfo></invoiceInfoList></ns2:queryInvoiceResponse>',
);
const NOT_YET = SOAP(
  '<ns2:queryInvoiceResponse xmlns:ns2="esf"><invoiceInfoList><invoiceInfo><invoiceId>555</invoiceId><invoiceStatus>IN_PROCESSING</invoiceStatus></invoiceInfo></invoiceInfoList></ns2:queryInvoiceResponse>',
);

describe('Banquet: ESF via IS ESF API (integration, fake network)', () => {
  let ctx: BanquetTestContext;
  let w: BanquetWorld;

  beforeAll(async () => {
    ctx = await createBanquetTestApp();
  });
  afterAll(async () => ctx.t.close());
  beforeEach(async () => {
    await resetBanquet(ctx);
    w = await banquetWorld(ctx);
    await ctx.t.get(IntegrationSettings).set(
      'banquet.esf_isesf',
      {
        enabled: true,
        config: {
          baseUrl: 'https://esf.test/api1/',
          username: '880101300123',
          tin: '123456789012',
          ncanodeUrl: 'http://ncanode.test',
          operatorFullname: 'Бухгалтер А.А.',
        },
        secrets: { password: 'esf-password', authCertificate: 'AUTHCERT', signCertificate: 'SIGNCERT', signKey: 'P12KEY', signKeyPassword: 'key-pass' },
      },
      null,
    );
  });

  const http = () => ctx.t.http();

  /** Заявка юрлица -> смета -> согласована -> (предоплата 0) prepaid -> held -> акт. Возвращает id акта. */
  async function heldCompanyAct(): Promise<{ actId: string; requestId: string }> {
    const company = await http()
      .post(api('/admin/banquets/companies'))
      .set('authorization', w.managerAuth)
      .send({ name: 'ТОО «Ромашка»', bin: '940140001234', legalAddress: 'Астана, ул. Кенесары 1' });
    const created = await http()
      .post(api('/admin/banquets/requests'))
      .set('authorization', w.managerAuth)
      .send({ ...publicRequestBody(w.branchId), consent: undefined, eventType: 'corporate', companyId: company.body.id });
    const id = created.body.id;
    const quote = await http()
      .post(api(`/admin/banquets/requests/${id}/quotes`))
      .set('authorization', w.managerAuth)
      .send({ lines: [{ kind: 'other', title: { ru: 'Корпоративный ужин' }, unit: 'чел.', unitPrice: { amount: 1_160_000 }, quantity: 50 }] });
    await http().post(api(`/admin/banquets/quotes/${quote.body.id}/send`)).set('authorization', w.managerAuth);
    await http().post(api(`/admin/banquets/requests/${id}/transition`)).set('authorization', w.managerAuth).send({ to: 'agreed' });
    const prepaid = await http().put(api(`/admin/banquets/requests/${id}/prepayment`)).set('authorization', w.managerAuth).send({ amount: { amount: 0 } });
    expect(prepaid.body.status).toBe('prepaid');
    ctx.t.clock.set(new Date('2026-11-15T06:00:00Z'));
    expect((await http().post(api(`/admin/banquets/requests/${id}/transition`)).set('authorization', w.managerAuth).send({ to: 'held' })).status).toBe(200);
    const act = await http().post(api(`/admin/banquets/requests/${id}/act`)).set('authorization', w.managerAuth);
    expect(act.status).toBe(201);
    expect(act.body.esf.status).toBe('pending');
    return { actId: act.body.id, requestId: id };
  }

  async function esfOf(requestId: string) {
    return (await http().get(api(`/admin/banquets/requests/${requestId}`)).set('authorization', w.managerAuth)).body.act.esf;
  }

  it('signs via NCANode, opens a session, uploads the invoice and stores the registration number', async () => {
    ctx.http
      .on('ncanode.test/cms/sign', 200, { status: 200, message: '', cms: 'MIIC-SIGNATURE' })
      .on('/SessionService', 200, SESSION)
      .on('/UploadInvoiceService', 200, ACCEPTED)
      .on('/InvoiceService', 200, REGISTERED);
    const { requestId } = await heldCompanyAct();
    await ctx.t.drain();

    expect(await esfOf(requestId)).toMatchObject({ status: 'registered', provider: 'isesf', esfId: '555', registrationNumber: 'ESF-940140001234-20261115-0001' });
    const urls = ctx.http.requests.map((r) => r.url);
    expect(urls).toEqual([
      'http://ncanode.test/cms/sign',
      'https://esf.test/api1/SessionService',
      'https://esf.test/api1/UploadInvoiceService',
      'https://esf.test/api1/InvoiceService',
      'https://esf.test/api1/SessionService',
    ]);
    const sign = JSON.parse(ctx.http.requests[0]!.body!);
    expect(Buffer.from(sign.data, 'base64').toString('utf8')).toContain('<tin>940140001234</tin>');
    expect(sign.signers[0]).toMatchObject({ key: 'P12KEY', password: 'key-pass' });
    const session = ctx.http.requests[1]!.body!;
    expect(session).toContain('<wsse:Username>880101300123</wsse:Username>');
    expect(session).toContain('<tin>123456789012</tin>');
    expect(session).toContain('<x509Certificate>AUTHCERT</x509Certificate>');
    const upload = ctx.http.requests[2]!.body!;
    expect(upload).toContain('<sessionId>SESSION-1</sessionId>');
    expect(upload).toContain('<signature>MIIC-SIGNATURE</signature>');
    expect(upload).toContain('<![CDATA[<?xml');
    expect(upload).toContain('<operatorFullname>Бухгалтер А.А.</operatorFullname>');
    expect(upload).toContain('<x509Certificate>SIGNCERT</x509Certificate>');
    expect(ctx.http.requests[2]!.headers['content-type']).toContain('text/xml');
    const docs = (await http().get(api(`/admin/banquets/requests/${requestId}/documents`)).set('authorization', w.managerAuth)).body;
    expect(docs.map((d: any) => d.kind)).toContain('esf_xml');
  });

  it('registration number comes later: status check job retries until registered', async () => {
    ctx.http
      .on('ncanode.test', 200, { cms: 'SIG' })
      .on('/SessionService', 200, SESSION)
      .on('/UploadInvoiceService', 200, ACCEPTED)
      .on('/InvoiceService', 200, NOT_YET, { times: 2 })
      .on('/InvoiceService', 200, REGISTERED);
    const { requestId } = await heldCompanyAct();
    await ctx.t.drain();
    expect(await esfOf(requestId)).toMatchObject({ status: 'sent', esfId: '555', registrationNumber: null });

    ctx.t.clock.advance(61_000);
    await ctx.t.drain();
    expect((await esfOf(requestId)).status).toBe('sent');
    ctx.t.clock.advance(61_000);
    await ctx.t.drain();
    expect(await esfOf(requestId)).toMatchObject({ status: 'registered', registrationNumber: 'ESF-940140001234-20261115-0001' });
  });

  it('declined invoice -> failed (no blind retries); manual retry after fixing; network errors are retried', async () => {
    ctx.http
      .on('ncanode.test', 200, { cms: 'SIG' })
      .on('/SessionService', 200, SESSION)
      .on('/UploadInvoiceService', 200, DECLINED, { times: 1 })
      .on('/UploadInvoiceService', 503, 'Service Unavailable', { times: 1 })
      .on('/UploadInvoiceService', 200, ACCEPTED)
      .on('/InvoiceService', 200, REGISTERED);
    const { actId, requestId } = await heldCompanyAct();
    await ctx.t.drain();
    const failed = await esfOf(requestId);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('Неверный БИН покупателя');

    const retry = await http().post(api(`/admin/banquets/acts/${actId}/esf/retry`)).set('authorization', w.financeAuth);
    expect(retry.status).toBe(201);
    await ctx.t.drain();
    // 503 — временная ошибка: статус остаётся pending, задача повторится.
    const pending = await esfOf(requestId);
    expect(pending.status).toBe('pending');
    expect(pending.error).toContain('503');

    ctx.t.clock.advance(31_000);
    await ctx.t.drain();
    expect(await esfOf(requestId)).toMatchObject({ status: 'registered', registrationNumber: 'ESF-940140001234-20261115-0001', error: null });
  });

  it('without ESF API settings (disabled) falls back to the manual XML draft', async () => {
    await ctx.t.get(IntegrationSettings).set('banquet.esf_isesf', { enabled: false, config: {} }, null);
    const { requestId } = await heldCompanyAct();
    await ctx.t.drain();
    expect(await esfOf(requestId)).toMatchObject({ status: 'draft_ready', provider: 'manual' });
    expect(ctx.http.requests).toHaveLength(0);
  });
});
