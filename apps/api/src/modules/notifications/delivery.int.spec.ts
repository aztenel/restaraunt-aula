import { createHmac } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakes, FakeHttpTransport, fakeProviders } from '../../../test/fakes';
import { createTestApp, TestApp } from '../../../test/support/test-app';
import { HttpTransport } from '../../shared/infrastructure/integrations/external-http';
import { IntegrationSettings } from '../../shared/infrastructure/settings/integration-settings';
import { FileStorage } from '../../shared/infrastructure/storage/file-storage';
import { ChannelRegistry } from './application/channel-registry';
import { SmtpMail, SmtpTransportFactory } from './infrastructure/adapters/smtp/smtp-email.adapter';
import { TemplateRepository } from './infrastructure/template.repository';
import { NotificationsModule } from './notifications.module';
import { AdminFeed, Notifier } from './public';

type Row = Record<string, any>;

describe('Notifications delivery (integration)', () => {
  let t: TestApp;
  let http: FakeHttpTransport;
  let mails: SmtpMail[];
  const fakes = createFakes();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [NotificationsModule],
      migrateModules: ['notifications'],
      providers: fakeProviders(fakes, { except: [Notifier, AdminFeed] }),
    });
    // Сеть подменяется: транспорт платформы делегирует в FakeHttpTransport текущего теста.
    vi.spyOn(t.get(HttpTransport), 'send').mockImplementation((input) => http.send(input));
    vi.spyOn(t.get(SmtpTransportFactory), 'create').mockImplementation(() => ({
      sendMail: async (mail: SmtpMail) => {
        mails.push(mail);
        return { messageId: `<m${mails.length}@aula.test>`, accepted: [mail.to], rejected: [] };
      },
    }));
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    t.get(IntegrationSettings).invalidate();
    http = new FakeHttpTransport();
    mails = [];
  });

  const db = () => t.database.rootConnection();
  const rows = async (query: ReturnType<typeof sql>) => (await query.execute(db())).rows as Row[];
  const notifier = () => t.get(Notifier);

  async function configure(key: string, config: Record<string, unknown>, secrets: Record<string, string> = {}) {
    await t.get(IntegrationSettings).set(key, { enabled: true, config, secrets }, null);
  }

  async function configureWhatsApp(templates: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    await configure(
      'notifications.whatsapp',
      { phoneNumberId: '1098765', templates, ...extra },
      { accessToken: 'EAAG-test-access-token-123', appSecret: 'app-secret-xyz' },
    );
  }

  async function messages(): Promise<Row[]> {
    return rows(sql`select * from notifications.messages order by created_at, id`);
  }

  async function deliveries(): Promise<Row[]> {
    return rows(sql`select * from notifications.deliveries order by created_at, id`);
  }

  async function attempts(): Promise<Row[]> {
    return rows(sql`select * from notifications.delivery_attempts order by occurred_at, delivery_id, attempt_no`);
  }

  /** Прогнать очередь, сдвигая время, пока повторы не закончатся. */
  async function drainWithRetries(rounds = 6) {
    await t.drain();
    for (let i = 0; i < rounds; i++) {
      t.clock.advance(15 * 60_000);
      await t.drain();
    }
  }

  const acceptedParams = { number: 'GL-2026-000001', trackingUrl: 'https://aula.kz/t/7KQ2MX', eta: '19:40' };

  it('guest notification is stored in the caller transaction and delivered by the job via WhatsApp', async () => {
    await configureWhatsApp({ 'order.accepted': { name: 'aula_order_accepted', languages: ['ru', 'kk'] } });
    http.on('graph.facebook.com', 200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC' }] });

    await t.database.transaction(async () => {
      await notifier().notifyGuest({
        recipient: { phone: '8 701 123 45 67', name: 'Айгерим' },
        template: 'order.accepted',
        params: acceptedParams,
        locale: 'kk',
        dedupeKey: 'order:o1:accepted',
        related: { type: 'order', id: 'o1' },
      });
    });
    const [queued] = await messages();
    expect(queued).toMatchObject({ status: 'queued', template: 'order.accepted', locale: 'kk', related_type: 'order', related_id: 'o1' });
    expect(queued!.recipient).toMatchObject({ kind: 'guest', phone: '+77011234567' });
    expect(queued!.channel_plan).toEqual([['whatsapp', 'sms']]);
    expect(http.requests).toHaveLength(0);
    const jobs = await rows(sql`select topic from platform.outbox where kind = 'job'`);
    expect(jobs.map((j) => j.topic)).toEqual(['notifications.deliver']);

    await t.drain();

    expect(http.requests).toHaveLength(1);
    const request = http.requests[0]!;
    expect(request.url).toBe('https://graph.facebook.com/v21.0/1098765/messages');
    expect(request.headers.authorization).toBe('Bearer EAAG-test-access-token-123');
    const body = JSON.parse(request.body!);
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '77011234567',
      type: 'template',
      template: { name: 'aula_order_accepted', language: { code: 'kk' } },
    });
    expect(body.template.components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'GL-2026-000001' },
          { type: 'text', text: 'https://aula.kz/t/7KQ2MX' },
          { type: 'text', text: '19:40' },
        ],
      },
    ]);

    const [message] = await messages();
    expect(message).toMatchObject({ status: 'sent', attempts: 1 });
    expect(message!.completed_at).toBeTruthy();
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ status: 'sent', channel: 'whatsapp', provider: 'whatsapp', external_id: 'wamid.ABC', attempts: 1 });
    expect(delivery!.rendered_text).toContain('№GL-2026-000001 тапсырыс қабылданды');
    const [attempt] = await attempts();
    expect(attempt).toMatchObject({ status: 'sent', channel: 'whatsapp', address_masked: '+7 701 *** ** 67', attempt_no: 1 });

    // Журнал интеграций: полный запрос с маскированием токена.
    const [log] = await rows(sql`select * from platform.integration_logs where integration = 'notifications.whatsapp'`);
    expect(log!.success).toBe(true);
    expect(JSON.stringify(log!.request)).not.toContain('EAAG-test-access-token-123');
  });

  it('messenger failure does not block the business transaction; WhatsApp 5xx exhausts retries and falls back to SMS', async () => {
    await configureWhatsApp({ 'order.accepted': 'aula_order_accepted' });
    await configure('notifications.mobizon', { from: 'AULA' }, { apiKey: 'mobizon-secret-key-123' });
    http.on('graph.facebook.com', 503, { error: { code: 131016, message: 'Service unavailable' } });
    http.on('api.mobizon.kz', 200, { code: 0, data: { messageId: '777', campaignId: '1' }, message: '' });

    await notifier().notifyGuest({ recipient: { phone: '+77011234567' }, template: 'order.accepted', params: acceptedParams, locale: 'ru' });
    await t.drain();
    // Первая попытка неудачна: задача отложена, сообщение ждёт повтора.
    expect((await messages())[0]!.status).toBe('queued');
    expect(http.requests.filter((r) => r.url.includes('graph.facebook.com'))).toHaveLength(1);

    await drainWithRetries();

    expect(http.requests.filter((r) => r.url.includes('graph.facebook.com'))).toHaveLength(3);
    const smsRequests = http.requests.filter((r) => r.url.includes('api.mobizon.kz'));
    expect(smsRequests).toHaveLength(1);
    expect(smsRequests[0]!.url).toContain('/service/message/sendsmsmessage?output=json&api=v1&apiKey=mobizon-secret-key-123');
    const form = new URLSearchParams(smsRequests[0]!.body);
    expect(form.get('recipient')).toBe('77011234567');
    expect(form.get('from')).toBe('AULA');
    expect(form.get('text')).toBe('AULA: заказ GL-2026-000001 принят, ориентировочно 19:40. https://aula.kz/t/7KQ2MX');

    const [message] = await messages();
    expect(message).toMatchObject({ status: 'sent', attempts: 4 });
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ status: 'sent', channel: 'sms', provider: 'mobizon', external_id: '777', step_index: 1 });
    const log = await attempts();
    expect(log.map((a) => `${a.channel}:${a.status}:${a.retryable}`)).toEqual([
      'whatsapp:failed:true',
      'whatsapp:failed:true',
      'whatsapp:failed:true',
      'sms:sent:false',
    ]);
    expect(log[0]!.error_code).toBe('http_503');

    const [smsLog] = await rows(sql`select * from platform.integration_logs where integration = 'notifications.mobizon'`);
    expect(smsLog!.request.url).toContain('apiKey=***');
    expect(JSON.stringify(smsLog!.request)).not.toContain('mobizon-secret-key-123');
    // Задача не ушла в очередь неудач.
    expect(await rows(sql`select * from platform.failed_jobs`)).toEqual([]);
  });

  it('permanent WhatsApp error (template not approved) falls back to SMS immediately', async () => {
    await configureWhatsApp({ 'order.accepted': 'aula_order_accepted' });
    await configure('notifications.smsc', {}, { login: 'aula', password: 'smsc-pass-123' });
    http.on('graph.facebook.com', 400, { error: { code: 132001, message: 'Template name does not exist in the translation' } });
    http.on('smsc.kz', 200, { id: 42, cnt: 1 });

    await notifier().notifyGuest({ recipient: { phone: '+77011234567' }, template: 'order.accepted', params: acceptedParams, locale: 'ru' });
    await t.drain();

    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ status: 'sent', channel: 'sms', provider: 'smsc', external_id: '42' });
    expect((await attempts()).map((a) => `${a.channel}:${a.status}:${a.retryable}`)).toEqual(['whatsapp:failed:false', 'sms:sent:false']);
    const [smsLog] = await rows(sql`select * from platform.integration_logs where integration = 'notifications.smsc'`);
    expect(smsLog!.request.body).toContain('psw=***');
    expect(smsLog!.request.body).not.toContain('smsc-pass-123');
  });

  it('in the test environment an unconfigured channel is delivered to the log channel', async () => {
    await notifier().notifyGuest({ recipient: { phone: '+77011234567' }, template: 'order.completed', params: { number: 'GL-1' }, locale: 'ru' });
    await t.drain();

    expect(http.requests).toEqual([]);
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ status: 'sent', channel: 'whatsapp', provider: 'log', address: '+77011234567' });
    expect(delivery!.rendered_text).toBe('Заказ №GL-1 выполнен. Спасибо, что выбрали AULA! Приятного аппетита!');
    expect((await attempts()).map((a) => `${a.channel}:${a.status}:${a.provider}`)).toEqual([
      'whatsapp:skipped:null',
      'sms:skipped:null',
      'whatsapp:sent:log',
    ]);
    expect((await messages())[0]!.status).toBe('sent');
  });

  it('in production an unconfigured channel chain fails the delivery (no log channel)', async () => {
    const registry = t.get(ChannelRegistry);
    const spy = vi.spyOn(registry, 'fallbackLog').mockReturnValue(null);
    try {
      await notifier().notifyGuest({ recipient: { phone: '+77011234567' }, template: 'order.completed', params: { number: 'GL-1' }, locale: 'ru' });
      await t.drain();
    } finally {
      spy.mockRestore();
    }
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ status: 'failed', provider: null });
    expect(delivery!.last_error).toContain('channel.not_configured');
    const [message] = await messages();
    expect(message).toMatchObject({ status: 'failed' });
    expect(message!.last_error).toContain('channel.not_configured');
  });

  it('repeated dedupeKey is a no-op; a rolled back business transaction leaves no notification', async () => {
    const input = {
      recipient: { phone: '+77011234567' },
      template: 'order.completed' as const,
      params: { number: 'GL-1' },
      locale: 'ru' as const,
      dedupeKey: 'order:o1:completed',
    };
    await t.database.transaction(async () => {
      await notifier().notifyGuest(input);
      await notifier().notifyGuest(input);
    });
    await notifier().notifyGuest(input);
    expect(await messages()).toHaveLength(1);
    expect(await rows(sql`select * from platform.outbox where topic = 'notifications.deliver'`)).toHaveLength(1);

    await expect(
      t.database.transaction(async () => {
        await notifier().notifyGuest({ ...input, dedupeKey: 'order:o2:completed' });
        throw new Error('order rejected');
      }),
    ).rejects.toThrow('order rejected');
    expect(await messages()).toHaveLength(1);

    await t.drain();
    await notifier().notifyGuest(input);
    await t.drain();
    expect(await deliveries()).toHaveLength(1);
  });

  it('one-time codes are stored encrypted, masked in the log and redacted in integration logs; stale codes are not sent', async () => {
    await configureWhatsApp({ 'otp.code': 'aula_otp' });
    http.on('graph.facebook.com', 200, { messages: [{ id: 'wamid.OTP' }] });

    await notifier().notifyGuest({ recipient: { phone: '+77011234567' }, template: 'otp.code', params: { code: '582941' }, locale: 'ru' });
    const [queued] = await messages();
    expect(queued!.params).toEqual({ code: '***' });
    expect(queued!.secret_params).toBeTruthy();
    expect(queued!.secret_params).not.toContain('582941');

    await t.drain();
    expect(JSON.parse(http.requests[0]!.body!).template.components[0].parameters).toEqual([{ type: 'text', text: '582941' }]);
    const [delivery] = await deliveries();
    expect(delivery!.rendered_text).toBe('Код подтверждения AULA: ***. Никому не сообщайте этот код.');
    const logs = await rows(sql`select request::text as request from platform.integration_logs`);
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) expect(log.request).not.toContain('582941');

    // Секрет удаляется по расписанию после завершения доставки.
    t.clock.advance(2 * 3600_000);
    await t.runSchedule('notifications.purge_secrets');
    expect((await messages())[0]!.secret_params).toBeNull();

    // Код, не доставленный за 10 минут, уже не отправляется.
    await notifier().notifyGuest({ recipient: { phone: '+77011234567' }, template: 'otp.code', params: { code: '111222' }, locale: 'ru' });
    t.clock.advance(11 * 60_000);
    await t.drain();
    const stale = (await messages())[1]!;
    expect(stale.status).toBe('failed');
    expect(http.requests).toHaveLength(1);
    expect((await attempts()).at(-1)).toMatchObject({ status: 'skipped', error_code: 'message.expired' });
  });

  it('renders templates edited in the admin (database) instead of the defaults, with locale fallback', async () => {
    await t.get(TemplateRepository).upsert({
      key: 'order.completed',
      channel: 'whatsapp',
      locale: 'ru',
      subject: null,
      body: 'Спасибо! Заказ {{number}} у вас.\nОтзыв: {{ number }}',
      updatedBy: null,
    });
    await notifier().notifyGuest({ recipient: { phone: '+77011234567' }, template: 'order.completed', params: { number: 'GL-7' }, locale: 'en' });
    await t.drain();
    const [delivery] = await deliveries();
    expect(delivery!.rendered_text).toBe('Спасибо! Заказ GL-7 у вас.\nОтзыв: GL-7');
  });

  it('documents go by email with attachments and by WhatsApp; guests without email get only WhatsApp/SMS', async () => {
    await configure('notifications.smtp', { host: 'smtp.aula.test', port: 587, from: 'AULA <noreply@aula.kz>' }, { password: 'smtp-pass' });
    const pdf = Buffer.from('%PDF-1.4 certificate');
    await t.get(FileStorage).put({ key: 'certificates/c1.pdf', body: pdf, contentType: 'application/pdf', visibility: 'private' });
    const params = { code: 'K7PQ-4MXZ-9TWA', nominal: '30 000 ₸', expiresAt: '25.10.2027', recipientName: '', message: 'С днём <b>рождения</b>!' };

    await notifier().notifyGuest({
      recipient: { phone: '+77011234567', email: 'Guest@Mail.kz' },
      template: 'certificate.issued',
      params,
      locale: 'ru',
      attachments: [{ fileKey: 'certificates/c1.pdf', filename: 'AULA-certificate.pdf', contentType: 'application/pdf' }],
    });
    await t.drain();

    expect((await messages())[0]!.channel_plan).toEqual([['email'], ['whatsapp', 'sms']]);
    const ds = await deliveries();
    expect(ds.map((d) => `${d.channel}:${d.provider}:${d.status}`)).toEqual(['email:smtp:sent', 'whatsapp:log:sent']);
    expect(mails).toHaveLength(1);
    const mail = mails[0]!;
    expect(mail).toMatchObject({ from: 'AULA <noreply@aula.kz>', to: 'guest@mail.kz', subject: 'Подарочный сертификат AULA на 30 000 ₸' });
    expect(mail.text).toContain('Код сертификата: K7PQ-4MXZ-9TWA');
    expect(mail.text).not.toContain('Получатель:');
    expect(mail.html).toContain('С днём &lt;b&gt;рождения&lt;/b&gt;!');
    expect(mail.attachments).toEqual([{ filename: 'AULA-certificate.pdf', contentType: 'application/pdf', content: pdf }]);
    const [smtpLog] = await rows(sql`select * from platform.integration_logs where integration = 'notifications.smtp'`);
    expect(JSON.stringify(smtpLog!.request)).not.toContain('K7PQ-4MXZ-9TWA');
    expect(smtpLog!.request.to).toBe('gu***@mail.kz');

    await notifier().notifyGuest({
      recipient: { phone: '+77011234567' },
      template: 'certificate.issued',
      params,
      locale: 'ru',
      attachments: [{ fileKey: 'certificates/c1.pdf', filename: 'AULA-certificate.pdf', contentType: 'application/pdf' }],
    });
    await t.drain();
    expect((await deliveries()).slice(2).map((d) => d.channel)).toEqual(['whatsapp']);
  });

  it('WhatsApp document header carries a signed link to the attachment', async () => {
    await configureWhatsApp({ 'banquet.quote_sent': { name: 'aula_quote', documentHeader: true, params: ['number', 'total', 'documentUrl'] } });
    http.on('graph.facebook.com', 200, { messages: [{ id: 'wamid.DOC' }] });
    await notifier().notifyGuest({
      recipient: { phone: '+77011234567' },
      template: 'banquet.quote_sent',
      params: { number: 'BQ-1', quoteUrl: 'https://aula.kz/q/1', total: '850 000 ₸', managerName: 'Айгерим' },
      locale: 'ru',
      channels: ['whatsapp'],
      attachments: [{ fileKey: 'quotes/q1.pdf', filename: 'Смета.pdf', contentType: 'application/pdf' }],
    });
    await t.drain();
    const components = JSON.parse(http.requests[0]!.body!).template.components;
    expect(components[0].type).toBe('header');
    expect(components[0].parameters[0].document.filename).toBe('Смета.pdf');
    expect(components[0].parameters[0].document.link).toContain('/files/private?');
    expect(components[1].parameters.map((p: { text: string }) => p.text)).toEqual([
      'BQ-1',
      '850 000 ₸',
      components[0].parameters[0].document.link,
    ]);
  });

  it('WhatsApp status webhook: signature check, delivered/read marks, asynchronous failure falls back to SMS, idempotent', async () => {
    await configureWhatsApp({ 'order.accepted': 'aula_order_accepted' }, { verifyToken: 'verify-me' });
    http.on('graph.facebook.com', 200, { messages: [{ id: 'wamid.W1' }] });
    await notifier().notifyGuest({ recipient: { phone: '+77011234567' }, template: 'order.accepted', params: acceptedParams, locale: 'ru' });
    await t.drain();
    expect((await deliveries())[0]).toMatchObject({ status: 'sent', external_id: 'wamid.W1' });

    const verify = await t
      .http()
      .get('/api/v1/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' });
    expect(verify.status).toBe(200);
    expect(verify.text).toBe('12345');
    const badVerify = await t
      .http()
      .get('/api/v1/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' });
    expect(badVerify.status).toBe(403);

    const statusBody = (status: string, errors?: unknown[]) => ({
      object: 'whatsapp_business_account',
      entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.W1', status, timestamp: '1790000000', errors }] } }] }],
    });
    const sign = (body: unknown) => `sha256=${createHmac('sha256', 'app-secret-xyz').update(JSON.stringify(body)).digest('hex')}`;
    const post = (body: unknown, signature = sign(body)) =>
      t.http().post('/api/v1/webhooks/whatsapp').set('x-hub-signature-256', signature).send(body as object);

    const delivered = statusBody('delivered');
    expect((await post(delivered, 'sha256=bad')).status).toBe(403);
    const res = await post(delivered);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, applied: 1, ignored: 0 });
    expect((await deliveries())[0]!.delivered_at).toBeTruthy();
    expect((await post(statusBody('read'))).body).toEqual({ received: true, applied: 1, ignored: 0 });
    expect((await deliveries())[0]!.read_at).toBeTruthy();
    // Статус по неизвестному сообщению игнорируется.
    const foreign = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.OTHER', status: 'delivered' }] } }] }] };
    expect((await post(foreign)).body).toEqual({ received: true, applied: 0, ignored: 1 });

    // Номер не зарегистрирован в WhatsApp: ошибка приходит вебхуком после «отправлено» -> SMS (в тестах — журнал).
    const failed = statusBody('failed', [{ code: 131026, title: 'Message undeliverable' }]);
    expect((await post(failed)).body).toEqual({ received: true, applied: 1, ignored: 0 });
    expect((await messages())[0]!.status).toBe('queued');
    await t.drain();
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ status: 'sent', channel: 'sms', provider: 'log' });
    expect((await messages())[0]!.status).toBe('sent');
    expect((await attempts()).map((a) => `${a.channel}:${a.status}:${a.error_code}`)).toEqual([
      'whatsapp:sent:null',
      'whatsapp:failed:131026',
      'sms:skipped:channel.not_configured',
      'sms:sent:null',
    ]);

    // Повтор того же вебхука ничего не меняет.
    expect((await post(failed)).body).toEqual({ received: true, applied: 0, ignored: 1 });
    expect(await rows(sql`select * from platform.outbox where topic = 'notifications.deliver' and dispatched_at is null`)).toEqual([]);
  });
});
