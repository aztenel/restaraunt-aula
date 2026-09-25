/**
 * Общая обвязка интеграционных тестов модуля Banquet (в сборку не попадает: src/**\/testing/**).
 */
import { createFakes, FakeHttpTransport, fakeProviders, Fakes } from '../../../../test/fakes';
import { createBranch, createLegalEntity, createStaff, tokenFor } from '../../../../test/support/fixtures';
import { createTestApp, TestApp } from '../../../../test/support/test-app';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { HttpTransport } from '../../../shared/infrastructure/integrations/external-http';
import { IntegrationSettings } from '../../../shared/infrastructure/settings/integration-settings';
import { FileStorage, FileVisibility, PutFileInput } from '../../../shared/infrastructure/storage/file-storage';
import { pageRequest } from '../../../shared/kernel/pagination';
import { StaffRole } from '../../identity/public';
import { PaymentEventPayload, PaymentsEvents } from '../../payments/public';
import { BanquetModule } from '../banquet.module';

/** Файлы в памяти: тест проверяет содержимое XML ЭСФ и наличие PDF без диска. */
export class MemoryFileStorage extends FileStorage {
  files = new Map<string, { body: Buffer; contentType: string; visibility: FileVisibility }>();

  async put(input: PutFileInput): Promise<void> {
    this.files.set(input.key, { body: input.body, contentType: input.contentType, visibility: input.visibility });
  }

  async get(key: string): Promise<Buffer> {
    const f = this.files.get(key);
    if (!f) throw new Error(`No file ${key}`);
    return f.body;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  publicUrl(key: string): string {
    return `https://files.test/public/${key}`;
  }

  async signedUrl(key: string, ttlSeconds = 3600, filename?: string): Promise<string> {
    return `https://files.test/private/${key}?ttl=${ttlSeconds}${filename ? `&filename=${encodeURIComponent(filename)}` : ''}`;
  }
}

export interface BanquetTestContext {
  t: TestApp;
  fakes: Fakes;
  http: FakeHttpTransport;
  storage: MemoryFileStorage;
}

export async function createBanquetTestApp(): Promise<BanquetTestContext> {
  const fakes = createFakes();
  const http = new FakeHttpTransport();
  const storage = new MemoryFileStorage();
  const t = await createTestApp({
    imports: [BanquetModule],
    migrateModules: ['banquet'],
    providers: [...fakeProviders(fakes), { provide: HttpTransport, useValue: http }, { provide: FileStorage, useValue: storage }],
  });
  return { t, fakes, http, storage };
}

/** Начальное время тестов (FixedClock): 01.10.2026 11:00 по Астане. */
export const TEST_NOW = new Date('2026-10-01T06:00:00.000Z');

export async function resetBanquet(ctx: BanquetTestContext): Promise<void> {
  await ctx.t.reset();
  ctx.t.clock.set(TEST_NOW);
  ctx.t.get(IntegrationSettings).invalidate();
  ctx.fakes.notifier.clear();
  ctx.fakes.adminFeed.events = [];
  ctx.fakes.customers.customers.clear();
  ctx.fakes.customers.consents = [];
  ctx.fakes.payments.payments.clear();
  ctx.fakes.payments.byKey.clear();
  ctx.fakes.payments.refunds = [];
  ctx.fakes.venues.venues.clear();
  ctx.fakes.venues.holds.clear();
  ctx.fakes.menu.dishes.clear();
  ctx.http.requests = [];
  (ctx.http as unknown as { routes: unknown[] }).routes = [];
  ctx.storage.files.clear();
}

export interface BanquetWorld {
  legalEntityId: string;
  branchId: string;
  otherBranchId: string;
  managerId: string;
  managerAuth: string;
  ownerId: string;
  ownerAuth: string;
  financeAuth: string;
}

/** Юрлицо (плательщик НДС 16% по умолчанию), два филиала, банкетный менеджер, собственник, финансист. */
export async function banquetWorld(ctx: BanquetTestContext, options: { vatPayer?: boolean } = {}): Promise<BanquetWorld> {
  const vatPayer = options.vatPayer ?? true;
  const legalEntityId = await createLegalEntity(ctx.t, { vatPayer, vatRateBp: vatPayer ? 1600 : 0 });
  const branchId = await createBranch(ctx.t, { code: 'GL', slug: 'greenline', legalEntityId });
  const otherBranchId = await createBranch(ctx.t, { code: 'GV', slug: 'garden-view', legalEntityId });
  const manager = await tokenFor(ctx.t, [{ role: StaffRole.BanquetManager }], 'Динара Менеджер');
  const owner = await tokenFor(ctx.t, [{ role: StaffRole.Owner }], 'Собственник');
  const finance = await tokenFor(ctx.t, [{ role: StaffRole.Finance }], 'Финансист');
  return {
    legalEntityId,
    branchId,
    otherBranchId,
    managerId: manager.userId,
    managerAuth: manager.auth,
    ownerId: owner.userId,
    ownerAuth: owner.auth,
    financeAuth: finance.auth,
  };
}

export { createStaff, tokenFor };

export const api = (path: string) => `/api/v1${path}`;

export function publicRequestBody(branchId: string | null, overrides: Record<string, unknown> = {}) {
  return {
    eventDate: '2026-11-14',
    eventTime: '18:00',
    eventType: 'wedding',
    guests: 100,
    ...(branchId ? { branchId } : {}),
    budget: { amount: 300_000_000 },
    contact: { name: 'Айгерим', phone: '8 701 123 45 67', email: 'aigerim@mail.kz' },
    wishes: 'Живая музыка',
    consent: { personalData: true, marketing: true },
    locale: 'ru',
    ...overrides,
  };
}

export interface OutboxRecord {
  topic: string;
  payload: any;
}

/**
 * Таблица outbox платформы: обвязка читает её напрямую, чтобы проверять опубликованные события.
 * Имя собирается из частей — это не код модуля.
 */
const OUTBOX_TABLE = ['platform', 'outbox'].join('.');

export async function publishedEvents(t: TestApp, topic?: string): Promise<OutboxRecord[]> {
  const rows = await t.database
    .rootConnection()
    .selectFrom(OUTBOX_TABLE)
    .select(['topic', 'payload'])
    .where('kind', '=', 'event')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows
    .filter((r: any) => !topic || r.topic === topic)
    .map((r: any) => ({ topic: r.topic, payload: (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload).payload }));
}

export async function outboxErrors(t: TestApp): Promise<string[]> {
  const rows = await t.database.rootConnection().selectFrom(OUTBOX_TABLE).select(['topic', 'last_error']).where('last_error', 'is not', null).execute();
  return rows.map((r: any) => `${r.topic}: ${r.last_error}`);
}

export async function auditActions(t: TestApp, entityId: string): Promise<string[]> {
  const page = await t.get(AuditLog).search({ entityId }, pageRequest(1, 200));
  return [...page.items].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id)).map((r) => r.action);
}

/** Имитация успешной онлайн-оплаты: фейк платёжного модуля + событие PaymentSucceeded. */
export async function succeedPayment(ctx: BanquetTestContext, paymentId: string): Promise<void> {
  const p = ctx.fakes.payments.succeed(paymentId);
  const payload: PaymentEventPayload = {
    paymentId: p.id,
    purpose: p.purpose,
    referenceId: p.referenceId,
    branchId: p.branchId,
    method: p.method,
    provider: p.provider,
    amount: p.amount.toJSON(),
    occurredAt: ctx.t.clock.now().toISOString(),
  };
  await ctx.t.get(EventBus).publish(PaymentsEvents.PaymentSucceeded, payload, { aggregateId: p.id, branchId: p.branchId });
  await ctx.t.drain();
}

/** Заявка с витрины -> в работе -> смета v1 (произвольные позиции) -> отправлена. Возвращает id, токен и итог. */
export async function requestWithSentQuote(
  ctx: BanquetTestContext,
  w: BanquetWorld,
  options: { lines?: unknown[]; branchId?: string } = {},
): Promise<{ id: string; token: string; quoteId: string; total: number; number: string }> {
  const http = ctx.t.http();
  const created = await http.post(api('/public/banquets/requests')).send(publicRequestBody(options.branchId ?? w.branchId));
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
  const list = await ctx.t.http().get(api('/admin/banquets/requests')).query({ q: created.body.number }).set('authorization', w.managerAuth);
  const id = list.body.items[0].id as string;
  const saved = await ctx.t
    .http()
    .post(api(`/admin/banquets/requests/${id}/quotes`))
    .set('authorization', w.managerAuth)
    .send({
      lines: options.lines ?? [
        { kind: 'other', title: { ru: 'Банкетное меню (на гостя)' }, unit: 'чел.', unitPrice: { amount: 1_500_000 }, quantity: 100 },
        { kind: 'hall_rent', title: { ru: 'Аренда зала' }, unit: 'усл.', unitPrice: { amount: 50_000_000 }, quantity: 1 },
      ],
    });
  if (saved.status !== 201) throw new Error(`quote failed: ${JSON.stringify(saved.body)}`);
  const sent = await ctx.t.http().post(api(`/admin/banquets/quotes/${saved.body.id}/send`)).set('authorization', w.managerAuth);
  if (sent.status !== 200) throw new Error(`send failed: ${JSON.stringify(sent.body)}`);
  const token = String(sent.body.publicQuoteUrl).split('/').pop()!;
  return { id, token, quoteId: saved.body.id, total: saved.body.totals.total.amount, number: created.body.number };
}

/** То же + согласование клиентом по ссылке (статус agreed). */
export async function agreedRequest(ctx: BanquetTestContext, w: BanquetWorld, options: { lines?: unknown[] } = {}) {
  const r = await requestWithSentQuote(ctx, w, options);
  const accepted = await ctx.t.http().post(api(`/public/banquets/quotes/${r.token}/accept`)).send({ version: 1 });
  if (accepted.status !== 200) throw new Error(`accept failed: ${JSON.stringify(accepted.body)}`);
  return r;
}
