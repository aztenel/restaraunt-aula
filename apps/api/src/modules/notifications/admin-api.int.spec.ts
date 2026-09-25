import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakes, fakeProviders } from '../../../test/fakes';
import { tokenFor } from '../../../test/support/fixtures';
import { createTestApp, TestApp } from '../../../test/support/test-app';
import { buildOpenApiDocument } from '../../shared/infrastructure/http/swagger';
import { IntegrationCatalog } from '../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../shared/infrastructure/settings/integration-settings';
import { allDefaultTemplateTexts, defaultTemplateText } from './domain/default-templates';
import { seedNotifications } from './infrastructure/seed';
import { NotificationsModule } from './notifications.module';
import { AdminFeed, Notifier } from './public';

type Row = Record<string, any>;

describe('Notifications admin API (integration)', () => {
  let t: TestApp;
  const fakes = createFakes();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [NotificationsModule],
      migrateModules: ['notifications'],
      providers: fakeProviders(fakes, { except: [Notifier, AdminFeed] }),
    });
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    t.get(IntegrationSettings).invalidate();
  });

  const rows = async (query: ReturnType<typeof sql>) => (await query.execute(t.database.rootConnection())).rows as Row[];
  const api = (path: string) => `/api/v1/admin/notifications${path}`;

  describe('templates', () => {
    it('is closed by default: 401 without token, 403 without integrations.manage or content.manage', async () => {
      expect((await t.http().get(api('/templates'))).status).toBe(401);
      const { auth } = await tokenFor(t, [{ role: 'finance' }]);
      const res = await t.http().get(api('/templates')).set('authorization', auth);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('access.forbidden');
    });

    it('lists every template with texts per channel and locale; content manager may read', async () => {
      const { auth } = await tokenFor(t, [{ role: 'content_manager' }]);
      const res = await t.http().get(api('/templates')).set('authorization', auth);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(31);
      const created = res.body.find((x: Row) => x.key === 'order.created');
      expect(created).toMatchObject({ audience: 'guest', params: ['number', 'total', 'trackingUrl', 'branchName'], channels: ['whatsapp', 'sms', 'email'] });
      expect(created.texts.map((x: Row) => `${x.channel}/${x.locale}`)).toEqual(['whatsapp/kk', 'whatsapp/ru', 'sms/kk', 'sms/ru', 'email/kk', 'email/ru']);
      expect(created.texts.every((x: Row) => !x.customized && !x.stored)).toBe(true);
      const staff = res.body.find((x: Row) => x.key === 'staff.order_new');
      expect(staff.channels).toEqual(['whatsapp', 'telegram']);

      const otp = await t.http().get(api('/templates/otp.code')).set('authorization', auth);
      expect(otp.body.sensitiveParams).toEqual(['code']);
      const missing = await t.http().get(api('/templates/unknown.key')).set('authorization', auth);
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('notification_template.not_found');
    });

    it('updates a text with variable validation, writes the audit log, resets to default', async () => {
      const { auth, userId } = await tokenFor(t, [{ role: 'sysadmin' }]);
      const put = (path: string, body: object) => t.http().put(api(`/templates/${path}`)).set('authorization', auth).send(body);

      const unknown = await put('order.created/sms/ru', { body: 'Заказ {{number}} {{foo}}' });
      expect(unknown.status).toBe(422);
      expect(unknown.body.error).toMatchObject({ code: 'notification_template.unknown_variables', details: { variables: ['foo'] } });
      expect((await put('staff.order_new/sms/ru', { body: 'Заказ {{number}}' })).body.error.code).toBe(
        'notification_template.channel_not_supported',
      );
      expect((await put('order.created/email/ru', { body: 'Заказ {{number}}' })).body.error.code).toBe('notification_template.subject_required');
      expect((await put('order.created/fax/ru', { body: 'x' })).status).toBe(400);
      expect((await put('order.created/sms/ru', { body: 'x', extra: 1 })).status).toBe(400);

      const ok = await put('order.created/sms/ru', { body: 'AULA: заказ {{number}} на {{total}} принят. {{trackingUrl}}' });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ channel: 'sms', locale: 'ru', source: 'db', body: 'AULA: заказ {{number}} на {{total}} принят. {{trackingUrl}}' });
      const view = await t.http().get(api('/templates/order.created')).set('authorization', auth);
      expect(view.body.texts.find((x: Row) => x.channel === 'sms' && x.locale === 'ru')).toMatchObject({
        customized: true,
        stored: true,
        variables: ['number', 'total', 'trackingUrl'],
      });
      const [audit] = await rows(sql`select * from platform.audit_log where action = 'notification_template.updated'`);
      expect(audit).toMatchObject({ entity_type: 'notification_template', entity_id: 'order.created/sms/ru', actor_user_id: userId });
      expect(audit!.before.body).toBe(defaultTemplateText('order.created', 'sms', 'ru')!.body);

      const email = await put('order.created/email/kk', { subject: 'Тапсырыс {{number}}', body: 'Сәлем! {{number}}' });
      expect(email.body).toMatchObject({ subject: 'Тапсырыс {{number}}', source: 'db' });

      const reset = await t.http().post(api('/templates/order.created/sms/ru/reset')).set('authorization', auth);
      expect(reset.status).toBe(200);
      expect(reset.body.body).toBe(defaultTemplateText('order.created', 'sms', 'ru')!.body);
      expect(await rows(sql`select * from platform.audit_log where action = 'notification_template.reset'`)).toHaveLength(1);
    });

    it('seed inserts default texts for every key, channel and locale; idempotent and keeps edits', async () => {
      const logs: string[] = [];
      const ctx = { app: t.app, branches: {}, legalEntityId: '', ownerUserId: '', demo: false, log: (m: string) => logs.push(m) };
      await seedNotifications(ctx);
      const count = await rows(sql`select count(*)::int as n from notifications.templates`);
      expect(count[0]!.n).toBe(allDefaultTemplateTexts().length);
      expect(allDefaultTemplateTexts().length).toBe(21 * 3 * 2 + 10 * 2 * 2);
      await sql`update notifications.templates set body = 'Изменено {{number}}' where key = 'order.completed' and channel = 'sms' and locale = 'ru'`.execute(
        t.database.rootConnection(),
      );
      await seedNotifications(ctx);
      const [edited] = await rows(sql`select body from notifications.templates where key = 'order.completed' and channel = 'sms' and locale = 'ru'`);
      expect(edited!.body).toBe('Изменено {{number}}');
      expect((await rows(sql`select count(*)::int as n from notifications.templates`))[0]!.n).toBe(allDefaultTemplateTexts().length);
      expect(logs.at(-1)).toContain('без изменений');
    });

    it('previews stored texts and drafts with sample or custom parameters', async () => {
      const { auth } = await tokenFor(t, [{ role: 'content_manager' }]);
      const preview = (key: string, body: object) => t.http().post(api(`/templates/${key}/preview`)).set('authorization', auth).send(body);

      const sms = await preview('order.accepted', { channel: 'sms', locale: 'ru' });
      expect(sms.status).toBe(200);
      expect(sms.body).toMatchObject({
        channel: 'sms',
        text: 'AULA: заказ GL-2026-000123 принят, ориентировочно 19:40. https://aula.kz/t/7KQ2MX',
        unknownVariables: [],
        sms: { encoding: 'ucs2', segments: 2 },
      });

      const draft = await preview('order.accepted', { channel: 'whatsapp', locale: 'kk', body: 'Тапсырыс {{number}}: {{eta}} {{oops}}', params: { eta: '20:00' } });
      expect(draft.body).toMatchObject({ text: 'Тапсырыс GL-2026-000123: 20:00', unknownVariables: ['oops'], sms: null, html: null });

      const email = await preview('certificate.issued', { channel: 'email', locale: 'ru', params: { recipientName: '' } });
      expect(email.body.subject).toBe('Подарочный сертификат AULA на 30 000 ₸');
      expect(email.body.text).not.toContain('Получатель');
      expect(email.body.html).toContain('<!doctype html>');

      const staffOnSms = await preview('staff.system_alert', { channel: 'sms', locale: 'ru' });
      expect(staffOnSms.body.channel).toBe('whatsapp');

      const badParam = await preview('order.accepted', { channel: 'sms', locale: 'ru', params: { nope: '1' } });
      expect(badParam.status).toBe(422);
      expect(badParam.body.error.code).toBe('notification_template.unknown_params');
      expect((await preview('order.accepted', { channel: 'sms', locale: 'ru', params: { eta: 5 } })).status).toBe(400);
    });
  });

  describe('delivery log, resend, test send, channels', () => {
    async function notifyAndDeliver() {
      await t.get(Notifier).notifyGuest({
        recipient: { phone: '+77011234567', email: 'guest@mail.kz' },
        template: 'order.created',
        params: { number: 'GL-1', total: '5 000 ₸', trackingUrl: 'https://aula.kz/t/1', branchName: 'GL' },
        locale: 'ru',
        related: { type: 'order', id: 'o1' },
      });
      await t.get(Notifier).notifyGuest({
        recipient: { phone: '+77019999999' },
        template: 'otp.code',
        params: { code: '4321' },
        locale: 'kk',
      });
      await t.get(Notifier).notifyGuest({ recipient: { email: 'only@mail.kz' }, template: 'order.completed', params: { number: 'GL-2' }, locale: 'ru' });
      await t.drain();
    }

    it('requires integrations.manage', async () => {
      expect((await t.http().get(api('/deliveries'))).status).toBe(401);
      const { auth } = await tokenFor(t, [{ role: 'content_manager' }]);
      expect((await t.http().get(api('/deliveries')).set('authorization', auth)).status).toBe(403);
      expect((await t.http().post(api('/test-send')).set('authorization', auth).send({ channel: 'sms', to: '+77011234567' })).status).toBe(403);
    });

    it('filters the log by status, channel, template, date and recipient; recipients are masked', async () => {
      await notifyAndDeliver();
      const { auth } = await tokenFor(t, [{ role: 'sysadmin' }]);
      const log = (query: Record<string, string | number> = {}) => t.http().get(api('/deliveries')).query(query).set('authorization', auth);

      const all = await log();
      expect(all.status).toBe(200);
      expect(all.body).toMatchObject({ total: 3, page: 1, perPage: 50 });
      const created = all.body.items.find((i: Row) => i.template === 'order.created');
      expect(created).toMatchObject({
        channel: 'whatsapp',
        provider: 'log',
        recipient: '+7 701 *** ** 67',
        status: 'sent',
        messageStatus: 'sent',
        related: { type: 'order', id: 'o1' },
      });
      expect(JSON.stringify(all.body)).not.toContain('+77011234567');
      const failed = all.body.items.find((i: Row) => i.status === 'failed');
      expect(failed).toMatchObject({ template: 'order.completed', recipient: '—', lastError: 'no_recipient_address' });

      expect((await log({ status: 'failed' })).body.total).toBe(1);
      expect((await log({ channel: 'whatsapp', status: 'sent' })).body.total).toBe(2);
      expect((await log({ template: 'otp.code' })).body.items[0].locale).toBe('kk');
      expect((await log({ recipient: '8 701 123 45 67' })).body.total).toBe(1);
      expect((await log({ recipient: '+77010000000' })).body.total).toBe(0);
      expect((await log({ relatedType: 'order', relatedId: 'o1' })).body.total).toBe(1);
      expect((await log({ from: '2026-10-01T05:00:00Z', to: '2026-10-01T07:00:00Z' })).body.total).toBe(3);
      expect((await log({ from: '2026-10-02T00:00:00Z' })).body.total).toBe(0);
      expect((await log({ perPage: 1, page: 2 })).body.items).toHaveLength(1);
      expect((await log({ status: 'bogus' })).status).toBe(400);
    });

    it('shows delivery details with the attempt log; codes stay hidden', async () => {
      await notifyAndDeliver();
      const { auth } = await tokenFor(t, [{ role: 'sysadmin' }]);
      const otp = (await t.http().get(api('/deliveries')).query({ template: 'otp.code' }).set('authorization', auth)).body.items[0];
      const detail = await t.http().get(api(`/deliveries/${otp.id}`)).set('authorization', auth);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({
        params: { code: '***' },
        chain: [
          { channel: 'whatsapp', recipient: '+7 701 *** ** 99' },
          { channel: 'sms', recipient: '+7 701 *** ** 99' },
        ],
        renderedText: 'AULA растау коды: ***. Бұл кодты ешкімге айтпаңыз.',
      });
      expect(detail.body.attemptLog.map((a: Row) => `${a.attemptNo}:${a.channel}:${a.status}`)).toEqual([
        '1:whatsapp:skipped',
        '2:sms:skipped',
        '3:whatsapp:sent',
      ]);
      expect(JSON.stringify(detail.body)).not.toContain('4321');
      expect((await t.http().get(api('/deliveries/00000000-0000-7000-8000-000000000000')).set('authorization', auth)).status).toBe(404);
      expect((await t.http().get(api('/deliveries/not-a-uuid')).set('authorization', auth)).status).toBe(400);
    });

    it('resends a delivery as a new message; one-time codes cannot be resent after purge', async () => {
      await notifyAndDeliver();
      const { auth, userId } = await tokenFor(t, [{ role: 'sysadmin' }]);
      const items = (await t.http().get(api('/deliveries')).set('authorization', auth)).body.items as Row[];
      const created = items.find((i) => i.template === 'order.created')!;

      const res = await t.http().post(api(`/deliveries/${created.id}/resend`)).set('authorization', auth);
      expect(res.status).toBe(201);
      const [message] = await rows(sql`select * from notifications.messages where id = ${res.body.messageId}`);
      expect(message).toMatchObject({ resent_from_id: created.messageId, created_by: userId, template: 'order.created', status: 'queued' });
      // Пока доставка не завершена, повторить её нельзя.
      const pending = await t.http().post(api(`/deliveries/${res.body.deliveryId}/resend`)).set('authorization', auth);
      expect(pending.status).toBe(409);
      expect(pending.body.error.code).toBe('notification.delivery_pending');
      await t.drain();
      const resent = await t.http().get(api(`/deliveries/${res.body.deliveryId}`)).set('authorization', auth);
      expect(resent.body).toMatchObject({ status: 'sent', resentFromId: created.messageId, recipient: '+7 701 *** ** 67' });
      expect(await rows(sql`select * from platform.audit_log where action = 'notification.resent'`)).toHaveLength(1);

      const noAddress = items.find((i) => i.status === 'failed')!;
      expect((await t.http().post(api(`/deliveries/${noAddress.id}/resend`)).set('authorization', auth)).body.error.code).toBe(
        'notification.no_address',
      );

      const otp = items.find((i) => i.template === 'otp.code')!;
      t.clock.advance(2 * 3600_000);
      await t.runSchedule('notifications.purge_secrets');
      const unavailable = await t.http().post(api(`/deliveries/${otp.id}/resend`)).set('authorization', auth);
      expect(unavailable.status).toBe(409);
      expect(unavailable.body.error.code).toBe('notification.resend_unavailable');
    });

    it('sends a test message to a channel and reports channel status', async () => {
      const { auth } = await tokenFor(t, [{ role: 'sysadmin' }], 'Админ');
      const invalid = await t.http().post(api('/test-send')).set('authorization', auth).send({ channel: 'sms', to: '123' });
      expect(invalid.status).toBe(422);
      expect(invalid.body.error.code).toBe('phone.invalid');
      expect(
        (await t.http().post(api('/test-send')).set('authorization', auth).send({ channel: 'telegram', to: 'not a chat' })).body.error.code,
      ).toBe('notification.invalid_chat_id');
      expect((await t.http().post(api('/test-send')).set('authorization', auth).send({ channel: 'fax', to: 'x' })).status).toBe(400);

      const res = await t.http().post(api('/test-send')).set('authorization', auth).send({ channel: 'sms', to: '8 701 123 45 67' });
      expect(res.status).toBe(201);
      await t.drain();
      const detail = await t.http().get(api(`/deliveries/${res.body.deliveryId}`)).set('authorization', auth);
      expect(detail.body).toMatchObject({
        template: 'staff.system_alert',
        channel: 'sms',
        provider: 'log',
        status: 'sent',
        related: { type: 'test_send' },
        renderedText: 'Системное оповещение AULA: Тестовое сообщение AULA. Проверка канала sms. Отправил: Админ',
      });
      const guestTemplate = await t
        .http()
        .post(api('/test-send'))
        .set('authorization', auth)
        .send({ channel: 'email', to: 'Test@Mail.kz', template: 'order.created', locale: 'kk' });
      expect(guestTemplate.status).toBe(201);
      await t.drain();
      const email = await t.http().get(api(`/deliveries/${guestTemplate.body.deliveryId}`)).set('authorization', auth);
      expect(email.body).toMatchObject({ channel: 'email', recipient: 'te***@mail.kz', renderedSubject: '№GL-2026-000123 тапсырыс рәсімделді' });
      expect(await rows(sql`select * from platform.audit_log where action = 'notification.test_sent'`)).toHaveLength(2);

      const before = await t.http().get(api('/channels')).set('authorization', auth);
      expect(before.body).toEqual([
        { channel: 'whatsapp', configured: false, providers: [], logFallback: true },
        { channel: 'sms', configured: false, providers: [], logFallback: true },
        { channel: 'email', configured: false, providers: [], logFallback: true },
        { channel: 'telegram', configured: false, providers: [], logFallback: true },
      ]);
      await t.get(IntegrationSettings).set('notifications.smsc', { enabled: true, config: { login: 'aula' }, secrets: { password: 'x' } }, null);
      await t.get(IntegrationSettings).set('notifications.mobizon', { enabled: true, config: {}, secrets: { apiKey: 'mobizon-key-123' } }, null);
      const after = await t.http().get(api('/channels')).set('authorization', auth);
      expect(after.body[1]).toEqual({ channel: 'sms', configured: true, providers: ['mobizon', 'smsc'], logFallback: true });
    });

    it('documents every route of the module in OpenAPI with tags, auth and typed responses', () => {
      const doc = buildOpenApiDocument(t.app, 'test');
      const expected: Array<[string, string, string, 'admin' | 'webhooks', boolean]> = [
        ['/api/v1/admin/notifications/templates', 'get', 'NotificationTemplateDto', 'admin', true],
        ['/api/v1/admin/notifications/templates/{key}', 'get', 'NotificationTemplateDto', 'admin', true],
        ['/api/v1/admin/notifications/templates/{key}/{channel}/{locale}', 'put', 'ResolvedTemplateTextDto', 'admin', true],
        ['/api/v1/admin/notifications/templates/{key}/{channel}/{locale}/reset', 'post', 'ResolvedTemplateTextDto', 'admin', true],
        ['/api/v1/admin/notifications/templates/{key}/preview', 'post', 'TemplatePreviewDto', 'admin', true],
        ['/api/v1/admin/notifications/deliveries', 'get', 'DeliveryLogPageDto', 'admin', true],
        ['/api/v1/admin/notifications/deliveries/{id}', 'get', 'DeliveryDetailDto', 'admin', true],
        ['/api/v1/admin/notifications/deliveries/{id}/resend', 'post', 'QueuedDeliveryDto', 'admin', true],
        ['/api/v1/admin/notifications/test-send', 'post', 'QueuedDeliveryDto', 'admin', true],
        ['/api/v1/admin/notifications/channels', 'get', 'ChannelStatusDto', 'admin', true],
        ['/api/v1/admin/feed/ticket', 'post', 'FeedTicketDto', 'admin', true],
        ['/api/v1/admin/feed/recent', 'get', 'FeedItemDto', 'admin', true],
        ['/api/v1/admin/feed/stream', 'get', '', 'admin', false],
        ['/api/v1/webhooks/whatsapp', 'get', '', 'webhooks', false],
        ['/api/v1/webhooks/whatsapp', 'post', 'WebhookAckDto', 'webhooks', false],
      ];
      for (const [path, method, schema, tag, bearer] of expected) {
        const op = (doc.paths[path] as Record<string, { tags?: string[]; responses: Record<string, unknown>; security?: unknown }>)?.[method];
        expect(op, `${method} ${path}`).toBeTruthy();
        expect(op!.tags).toContain(tag);
        if (bearer) expect(op!.security, `${method} ${path}`).toEqual([{ staff: [] }]);
        else expect(op!.security, `${method} ${path}`).toBeUndefined();
        if (schema) expect(JSON.stringify(op!.responses), `${method} ${path}`).toContain(`#/components/schemas/${schema}`);
      }
      const stream = (doc.paths['/api/v1/admin/feed/stream'] as Record<string, { responses: Record<string, unknown> }>).get;
      expect(JSON.stringify(stream!.responses)).toContain('text/event-stream');
      const template = doc.components!.schemas!.NotificationTemplateDto as { properties: Record<string, unknown> };
      expect(Object.keys(template.properties)).toEqual(expect.arrayContaining(['params', 'sensitiveParams', 'optionalParams', 'texts']));
    });

    it('registers integration descriptors of all channels in the catalog', () => {
      const keys = t
        .get(IntegrationCatalog)
        .list()
        .filter((d) => d.category === 'notifications')
        .map((d) => d.key)
        .sort();
      expect(keys).toEqual([
        'notifications.mobizon',
        'notifications.sms_routing',
        'notifications.smsc',
        'notifications.smtp',
        'notifications.telegram',
        'notifications.whatsapp',
      ]);
    });
  });
});
