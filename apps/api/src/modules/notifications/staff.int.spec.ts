import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakes, FakeHttpTransport, fakeProviders } from '../../../test/fakes';
import { createBranch, createStaff } from '../../../test/support/fixtures';
import { createTestApp, TestApp } from '../../../test/support/test-app';
import { HandlerExecutor } from '../../shared/infrastructure/events/handler-executor';
import { HttpTransport } from '../../shared/infrastructure/integrations/external-http';
import { IntegrationSettings } from '../../shared/infrastructure/settings/integration-settings';
import { Permission } from '../../shared/kernel/permissions';
import { UserRepository } from '../identity/infrastructure/user.repository';
import { NotificationsModule } from './notifications.module';
import { AdminFeed, Notifier } from './public';

type Row = Record<string, any>;

describe('Notifications to staff and system alerts (integration)', () => {
  let t: TestApp;
  let http: FakeHttpTransport;
  const fakes = createFakes();

  beforeAll(async () => {
    t = await createTestApp({
      imports: [NotificationsModule],
      migrateModules: ['notifications'],
      providers: fakeProviders(fakes, { except: [Notifier, AdminFeed] }),
    });
    vi.spyOn(t.get(HttpTransport), 'send').mockImplementation((input) => http.send(input));
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    t.get(IntegrationSettings).invalidate();
    http = new FakeHttpTransport();
  });

  const db = () => t.database.rootConnection();
  const rows = async (query: ReturnType<typeof sql>) => (await query.execute(db())).rows as Row[];
  const deliveries = () => rows(sql`select * from notifications.deliveries order by created_at, id`);

  async function staff(role: Parameters<typeof createStaff>[1][number], contacts: { phone?: string; telegramChatId?: string }, name: string) {
    const id = await createStaff(t, [role], name);
    await t.get(UserRepository).updateProfile(id, { phone: contacts.phone ?? null, telegramChatId: contacts.telegramChatId ?? null });
    return id;
  }

  const orderParams = { number: 'GL-2026-000010', type: 'доставка', total: '12 500 ₸', branchName: 'GL', adminUrl: 'https://admin.aula.kz/o/1' };

  it('resolves the audience by permission in the branch (global roles included) plus branch channels', async () => {
    const branchA = await createBranch(t, { settings: { staffNotifyPhone: '+77010000009', staffTelegramChatId: '-100500' } });
    const branchB = await createBranch(t);
    const operatorA = await staff({ role: 'branch_operator', branchId: branchA }, { phone: '+77010000001', telegramChatId: '1001' }, 'Оператор A');
    await staff({ role: 'branch_operator', branchId: branchB }, { phone: '+77010000002' }, 'Оператор B');
    const owner = await staff({ role: 'owner' }, { telegramChatId: '1003' }, 'Собственник');
    await staff({ role: 'finance' }, { phone: '+77010000004' }, 'Финансы');
    await staff({ role: 'branch_manager', branchId: branchA }, {}, 'Без контактов');

    await t.get(Notifier).notifyStaff({
      audience: { branchId: branchA, permission: Permission.OrdersManage, includeBranchChannels: true },
      template: 'staff.order_new',
      params: orderParams,
      dedupeKey: 'order:1:staff_new',
      related: { type: 'order', id: 'o1' },
    });
    const [message] = await rows(sql`select * from notifications.messages`);
    expect(message).toMatchObject({ audience: 'staff', locale: 'ru', branch_id: branchA, status: 'queued' });
    expect(message!.recipient).toEqual({
      kind: 'staff',
      branchId: branchA,
      permission: 'orders.manage',
      userIds: [],
      includeBranchChannels: true,
    });

    await t.drain();
    const ds = await deliveries();
    expect(ds.map((d) => `${d.target_kind}:${d.channel}:${d.address}`).sort()).toEqual(
      [
        'branch:telegram:-100500',
        'branch:whatsapp:+77010000009',
        'staff_user:telegram:1001',
        'staff_user:telegram:1003',
        'staff_user:whatsapp:+77010000001',
      ].sort(),
    );
    expect(ds.find((d) => d.address === '1003')!.staff_user_id).toBe(owner);
    expect(ds.find((d) => d.address === '1001')!.staff_user_id).toBe(operatorA);
    expect(ds.every((d) => d.status === 'sent' && d.provider === 'log')).toBe(true);
    const telegram = ds.find((d) => d.address === '1001')!;
    expect(telegram.rendered_text).toBe(
      'Новый заказ №GL-2026-000010\nТип: доставка\nФилиал: GL\nСумма: 12 500 ₸\nОткрыть: https://admin.aula.kz/o/1',
    );
    expect((await rows(sql`select status from notifications.messages`))[0]!.status).toBe('sent');
  });

  it('explicit users, branch channels by default, deactivated staff and empty audience', async () => {
    const branch = await createBranch(t, { settings: { staffNotifyPhone: '+77010000009' } });
    const manager = await staff({ role: 'banquet_manager' }, { phone: '+77010000005' }, 'Менеджер');
    const inactive = await staff({ role: 'banquet_manager' }, { phone: '+77010000006' }, 'Уволен');
    await t.get(UserRepository).updateProfile(inactive, { isActive: false });

    await t.get(Notifier).notifyStaff({
      audience: { branchId: null, userIds: [manager, inactive, manager] },
      template: 'staff.banquet_assigned',
      params: { number: 'BQ-1', eventDate: '14.11.2026', adminUrl: 'https://admin.aula.kz/b/1' },
    });
    await t.get(Notifier).notifyStaff({
      audience: { branchId: branch },
      template: 'staff.reservation_cancelled',
      params: { number: 'GV-1', date: '25.10.2026', time: '19:30' },
    });
    await t.get(Notifier).notifyStaff({
      audience: { branchId: branch, permission: Permission.BanquetsManage },
      template: 'staff.banquet_sla_breach',
      params: { number: 'BQ-1', minutes: '45', managerName: 'Менеджер', adminUrl: 'https://admin.aula.kz/b/1' },
    });
    await t.drain();

    const byTemplate = await rows(sql`
      select m.template, m.status, d.target_kind, d.address from notifications.messages m
      left join notifications.deliveries d on d.message_id = m.id order by m.created_at, m.id, d.address`);
    expect(byTemplate.map((r) => `${r.template}:${r.status}:${r.target_kind}:${r.address}`)).toEqual([
      'staff.banquet_assigned:sent:staff_user:+77010000005',
      'staff.reservation_cancelled:sent:branch:+77010000009',
      'staff.banquet_sla_breach:sent:staff_user:+77010000005',
    ]);
  });

  it('staff message without any contact is skipped', async () => {
    await t.get(Notifier).notifyStaff({
      audience: { branchId: null, permission: Permission.SystemJobs },
      template: 'staff.system_alert',
      params: { title: 'x', details: 'y' },
    });
    await t.drain();
    const [message] = await rows(sql`select * from notifications.messages`);
    expect(message).toMatchObject({ status: 'skipped', last_error: 'no_recipients' });
    expect(await deliveries()).toEqual([]);
  });

  it('Telegram bot delivers staff messages; the bot token never reaches the integration log', async () => {
    await t.get(IntegrationSettings).set(
      'notifications.telegram',
      { enabled: true, config: {}, secrets: { botToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw' } },
      null,
    );
    http.on('api.telegram.org', 200, { ok: true, result: { message_id: 55 } });
    await staff({ role: 'sysadmin' }, { telegramChatId: '-1001234567' }, 'Админ');
    await t.get(Notifier).notifyStaff({
      audience: { branchId: null, permission: Permission.SystemJobs },
      template: 'staff.system_alert',
      params: { title: 'Проверка', details: 'Всё хорошо' },
    });
    await t.drain();
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]!.url).toBe('https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage');
    expect(JSON.parse(http.requests[0]!.body!)).toEqual({
      chat_id: '-1001234567',
      text: 'Системное оповещение AULA\nПроверка\nВсё хорошо',
      disable_web_page_preview: true,
    });
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ status: 'sent', provider: 'telegram', external_id: '-1001234567:55' });
    const [log] = await rows(sql`select request from platform.integration_logs where integration = 'notifications.telegram'`);
    expect(log!.request.url).toBe('https://api.telegram.org/bot***/sendMessage');
  });

  it('job moved to the failed queue alerts system administrators and the system feed stream', async () => {
    await staff({ role: 'sysadmin' }, { telegramChatId: '2001' }, 'Администратор');
    await staff({ role: 'owner' }, { phone: '+77010000007' }, 'Собственник');
    await staff({ role: 'finance' }, { phone: '+77010000008' }, 'Финансы');
    const failedJobId = await t.get(HandlerExecutor).recordFailure({
      kind: 'job',
      topic: 'payments.poll_status',
      handler: 'PaymentPollJob.handle',
      payload: { paymentId: 'p1' },
      error: new Error('Kaspi timeout'),
      attempts: 8,
    });
    await t.drain();

    const [message] = await rows(sql`select * from notifications.messages`);
    expect(message).toMatchObject({ template: 'staff.system_alert', dedupe_key: `job_failed:${failedJobId}`, status: 'sent' });
    expect(message!.params.title).toBe('Задача в очереди неудач: payments.poll_status');
    expect(message!.params.details).toContain('Error: Kaspi timeout');
    expect((await deliveries()).map((d) => d.address).sort()).toEqual(['+77010000007', '2001']);
    const feed = await rows(sql`select * from notifications.admin_feed`);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ stream: 'system', kind: 'created', entity_id: failedJobId, sound: true, branch_id: null });

    // Сбой задачи доставки уведомлений: только лента (оповещать теми же каналами бессмысленно).
    await t.get(HandlerExecutor).recordFailure({
      kind: 'job',
      topic: 'notifications.deliver',
      handler: 'DeliverNotificationJob.handle',
      payload: { messageId: 'm1' },
      error: new Error('db down'),
      attempts: 15,
    });
    await t.drain();
    expect(await rows(sql`select * from notifications.messages`)).toHaveLength(1);
    expect(await rows(sql`select * from notifications.admin_feed`)).toHaveLength(2);
  });
});
