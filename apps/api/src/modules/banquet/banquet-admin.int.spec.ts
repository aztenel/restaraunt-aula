import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch, createLegalEntity } from '../../../test/support/fixtures';
import { EventBus } from '../../shared/infrastructure/events/event-bus';
import { IntegrationCatalog } from '../../shared/infrastructure/settings/integration-catalog';
import { CustomersEvents } from '../customers/public';
import { StaffRole } from '../identity/public';
import { BanquetEvents } from './public';
import {
  api,
  BanquetTestContext,
  banquetWorld,
  BanquetWorld,
  createBanquetTestApp,
  publicRequestBody,
  publishedEvents,
  requestWithSentQuote,
  resetBanquet,
  tokenFor,
} from './testing/banquet-test-kit';
import { DEFAULT_CONTRACT_TEMPLATE, DEFAULT_CONTRACT_TEMPLATE_CODE } from './infrastructure/seed';

describe('Banquet: admin (integration)', () => {
  let ctx: BanquetTestContext;
  let w: BanquetWorld;

  beforeAll(async () => {
    ctx = await createBanquetTestApp();
  });
  afterAll(async () => ctx.t.close());
  beforeEach(async () => {
    await resetBanquet(ctx);
    w = await banquetWorld(ctx);
  });

  const http = () => ctx.t.http();

  async function publicRequest(branchId: string | null, overrides: Record<string, unknown> = {}) {
    const res = await http().post(api('/public/banquets/requests')).send(publicRequestBody(branchId, overrides));
    expect(res.status).toBe(201);
    const list = await http().get(api('/admin/banquets/requests')).query({ q: res.body.number }).set('authorization', w.ownerAuth);
    return list.body.items[0] as { id: string; number: string; branchId: string | null };
  }

  it('permissions: banquet manager sees all branches, branch manager only own branch, operator nothing', async () => {
    const a = await publicRequest(w.branchId);
    const b = await publicRequest(w.otherBranchId, { contact: { name: 'Бота', phone: '+77012223344' } });

    expect((await http().get(api('/admin/banquets/requests'))).status).toBe(401);
    const operator = await tokenFor(ctx.t, [{ role: StaffRole.BranchOperator, branchId: w.branchId }]);
    const denied = await http().get(api('/admin/banquets/requests')).set('authorization', operator.auth);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('access.forbidden');

    const all = await http().get(api('/admin/banquets/requests')).set('authorization', w.managerAuth);
    expect(all.body.total).toBe(2);

    const branchManager = await tokenFor(ctx.t, [{ role: StaffRole.BranchManager, branchId: w.branchId }]);
    const own = await http().get(api('/admin/banquets/requests')).set('authorization', branchManager.auth);
    expect(own.status).toBe(200);
    expect(own.body.items.map((i: any) => i.id)).toEqual([a.id]);
    expect((await http().get(api(`/admin/banquets/requests/${a.id}`)).set('authorization', branchManager.auth)).status).toBe(200);
    const foreign = await http().get(api(`/admin/banquets/requests/${b.id}`)).set('authorization', branchManager.auth);
    expect(foreign.status).toBe(403);
    const otherFilter = await http().get(api('/admin/banquets/requests')).query({ branchId: w.otherBranchId }).set('authorization', branchManager.auth);
    expect(otherFilter.status).toBe(403);
    expect(otherFilter.body.error.code).toBe('access.forbidden_branch');
    // Управляющий видит, но не ведёт заявки (нет banquets.manage).
    const take = await http().post(api(`/admin/banquets/requests/${a.id}/transition`)).set('authorization', branchManager.auth).send({ to: 'in_progress' });
    expect(take.status).toBe(403);
    const create = await http()
      .post(api('/admin/banquets/requests'))
      .set('authorization', branchManager.auth)
      .send({ eventDate: '2026-11-01', eventType: 'birthday', guests: 10, branchId: w.branchId, contact: { name: 'Гость', phone: '+77010001122' } });
    expect(create.status).toBe(403);

    // Финансы видят заявки, но не меняют их.
    expect((await http().get(api(`/admin/banquets/requests/${b.id}`)).set('authorization', w.financeAuth)).status).toBe(200);
    expect((await http().patch(api(`/admin/banquets/requests/${b.id}`)).set('authorization', w.financeAuth).send({ guests: 50 })).status).toBe(403);

    const pipeline = await http().get(api('/admin/banquets/pipeline')).set('authorization', w.managerAuth);
    expect(pipeline.status).toBe(200);
    expect(pipeline.body.map((c: any) => c.status)).toEqual(['new', 'in_progress', 'quote_sent', 'agreed', 'prepaid', 'held', 'cancelled']);
    expect(pipeline.body[0].count).toBe(2);
    const scopedPipeline = await http().get(api('/admin/banquets/pipeline')).set('authorization', branchManager.auth);
    expect(scopedPipeline.body[0].items.map((i: any) => i.id)).toEqual([a.id]);
  });

  it('SLA: no response for 30 minutes -> one notification to the manager and owners; stats per manager', async () => {
    const r = await publicRequest(w.branchId);
    const answered = await publicRequest(w.branchId, { contact: { name: 'Марат', phone: '+77015556677' } });
    ctx.t.clock.advance(10 * 60_000);
    const call = await http()
      .post(api(`/admin/banquets/requests/${answered.id}/activities`))
      .set('authorization', w.managerAuth)
      .send({ kind: 'call', text: 'Перезвонила, обсудили меню' });
    expect(call.status).toBe(201);
    ctx.fakes.notifier.clear();

    ctx.t.clock.advance(19 * 60_000);
    await ctx.t.runSchedule('banquet.sla_check');
    expect(ctx.fakes.notifier.staff.filter((s) => s.template === 'staff.banquet_sla_breach')).toHaveLength(0);

    ctx.t.clock.advance(2 * 60_000);
    await ctx.t.runSchedule('banquet.sla_check');
    const breaches = ctx.fakes.notifier.staff.filter((s) => s.template === 'staff.banquet_sla_breach');
    expect(breaches).toHaveLength(1);
    expect((breaches[0]!.audience as any).userIds.sort()).toEqual([w.managerId, w.ownerId].sort());
    expect(breaches[0]!.params).toMatchObject({ number: r.number, minutes: '31', managerName: 'Динара Менеджер' });

    await ctx.t.runSchedule('banquet.sla_check');
    expect(ctx.fakes.notifier.staff.filter((s) => s.template === 'staff.banquet_sla_breach')).toHaveLength(1);

    const detail = await http().get(api(`/admin/banquets/requests/${r.id}`)).set('authorization', w.managerAuth);
    expect(detail.body.slaBreached).toBe(true);
    expect(detail.body.timeline[0].kind).toBe('sla_breach');
    const answeredDetail = await http().get(api(`/admin/banquets/requests/${answered.id}`)).set('authorization', w.managerAuth);
    expect(answeredDetail.body).toMatchObject({ slaBreached: false, status: 'new' });
    expect(answeredDetail.body.firstResponseAt).toBeTruthy();

    const breachedList = await http().get(api('/admin/banquets/requests')).query({ slaBreached: 'true' }).set('authorization', w.managerAuth);
    expect(breachedList.body.items.map((i: any) => i.id)).toEqual([r.id]);

    const stats = await http().get(api('/admin/banquets/sla-stats')).query({ from: '2026-10-01', to: '2026-10-01' }).set('authorization', w.ownerAuth);
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ total: 2, answered: 1, answeredWithinSla: 1, withinSlaShareBp: 5000, breached: 1, unanswered: 1, targetShareBp: 9500 });
    expect(stats.body.byManager).toHaveLength(1);
    expect(stats.body.byManager[0]).toMatchObject({ managerId: w.managerId, total: 2 });
  });

  it('venue hold through Reservation: conflict propagates as 409, moves with the date, calendar shows occupancy', async () => {
    const r = await publicRequest(w.branchId);
    const hall = ctx.fakes.venues.addVenue(w.branchId, { capacityMax: 150 });
    const small = ctx.fakes.venues.addVenue(w.branchId, { capacityMax: 20 });
    const foreignVenue = ctx.fakes.venues.addVenue(w.otherBranchId, { capacityMax: 150 });
    // Зал уже занят другой бронью 14.11 с 12:00 до 20:00 по Астане.
    await ctx.fakes.venues.holdForBanquet({
      venueId: hall.id,
      start: new Date('2026-11-14T07:00:00Z'),
      end: new Date('2026-11-14T15:00:00Z'),
      guests: 10,
      banquetRequestId: 'other',
    });

    const conflict = await http()
      .put(api(`/admin/banquets/requests/${r.id}/venue`))
      .set('authorization', w.managerAuth)
      .send({ venueId: hall.id, startTime: '18:00', endTime: '23:00' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('reservation.venue_occupied');
    const capacity = await http()
      .put(api(`/admin/banquets/requests/${r.id}/venue`))
      .set('authorization', w.managerAuth)
      .send({ venueId: small.id, startTime: '18:00', endTime: '23:00' });
    expect(capacity.status).toBe(422);
    const otherBranch = await http()
      .put(api(`/admin/banquets/requests/${r.id}/venue`))
      .set('authorization', w.managerAuth)
      .send({ venueId: foreignVenue.id, startTime: '18:00', endTime: '23:00' });
    expect(otherBranch.status).toBe(422);
    expect(otherBranch.body.error.code).toBe('banquet.venue_other_branch');

    const ok = await http()
      .put(api(`/admin/banquets/requests/${r.id}/venue`))
      .set('authorization', w.managerAuth)
      .send({ venueId: hall.id, startTime: '20:00', endTime: '02:00' });
    expect(ok.status).toBe(200);
    expect(ok.body.venue).toMatchObject({ venueId: hall.id, start: '2026-11-14T15:00:00.000Z', end: '2026-11-14T21:00:00.000Z', venueName: { ru: 'VIP-зал' } });
    const hold = ctx.fakes.venues.holds.get(ok.body.venue.reservationId)!;
    expect(hold).toMatchObject({ kind: 'banquet', banquetRequestId: r.id, guests: 100 });

    // Перенос даты — занятость зала переезжает вместе с заявкой.
    const moved = await http().patch(api(`/admin/banquets/requests/${r.id}`)).set('authorization', w.managerAuth).send({ eventDate: '2026-11-21', guests: 110 });
    expect(moved.status).toBe(200);
    expect(moved.body.venue).toMatchObject({ start: '2026-11-21T15:00:00.000Z', end: '2026-11-21T21:00:00.000Z' });
    expect(ctx.fakes.venues.holds.get(ok.body.venue.reservationId)).toMatchObject({ start: '2026-11-21T15:00:00.000Z', guests: 110 });
    const offsite = await http().patch(api(`/admin/banquets/requests/${r.id}`)).set('authorization', w.managerAuth).send({ offsite: true, address: 'Астана, Мангилик Ел 55' });
    expect(offsite.status).toBe(422);
    expect(offsite.body.error.code).toBe('banquet.venue_hold_exists');

    const calendar = await http()
      .get(api('/admin/banquets/calendar'))
      .query({ branchId: w.branchId, from: '2026-11-01', to: '2026-11-30' })
      .set('authorization', w.managerAuth);
    expect(calendar.status).toBe(200);
    expect(calendar.body.banquets.map((b: any) => b.id)).toEqual([r.id]);
    expect(calendar.body.occupancy).toHaveLength(2);
    expect(calendar.body.venues.map((v: any) => v.id).sort()).toEqual([hall.id, small.id].sort());
    const tooLong = await http()
      .get(api('/admin/banquets/calendar'))
      .query({ branchId: w.branchId, from: '2026-01-01', to: '2026-12-31' })
      .set('authorization', w.managerAuth);
    expect(tooLong.status).toBe(422);

    const released = await http().delete(api(`/admin/banquets/requests/${r.id}/venue`)).set('authorization', w.managerAuth);
    expect(released.status).toBe(200);
    expect(released.body.venue).toBeNull();
    expect(ctx.fakes.venues.holds.size).toBe(1);
  });

  it('offsite catering: address required, numbering by the default branch, executing branch chosen later, no venue', async () => {
    const noAddress = await http().post(api('/public/banquets/requests')).send(publicRequestBody(null, { offsite: true }));
    expect(noAddress.status).toBe(422);
    expect(noAddress.body.error.code).toBe('banquet.offsite_address_required');
    const noBranch = await http().post(api('/public/banquets/requests')).send(publicRequestBody(null));
    expect(noBranch.status).toBe(422);
    expect(noBranch.body.error.code).toBe('banquet.branch_required');

    const created = await http()
      .post(api('/public/banquets/requests'))
      .send(publicRequestBody(null, { offsite: true, address: 'Астана, ул. Сыганак 10, офис 5', eventType: 'kudalyk' }));
    expect(created.status).toBe(201);
    expect(created.body.number).toMatch(/^G[LV]-B-2026-\d{6}$/);
    const list = await http().get(api('/admin/banquets/requests')).query({ offsite: 'true' }).set('authorization', w.managerAuth);
    const r = list.body.items[0];
    expect(r).toMatchObject({ isOffsite: true, branchId: null, offsiteAddress: 'Астана, ул. Сыганак 10, офис 5', eventType: 'kudalyk' });
    // Управляющий филиалом не видит выезд без филиала-исполнителя.
    const branchManager = await tokenFor(ctx.t, [{ role: StaffRole.BranchManager, branchId: w.branchId }]);
    expect((await http().get(api(`/admin/banquets/requests/${r.id}`)).set('authorization', branchManager.auth)).status).toBe(403);

    const venue = ctx.fakes.venues.addVenue(w.branchId);
    const noVenue = await http()
      .put(api(`/admin/banquets/requests/${r.id}/venue`))
      .set('authorization', w.managerAuth)
      .send({ venueId: venue.id, startTime: '18:00', endTime: '22:00' });
    expect(noVenue.status).toBe(422);
    expect(noVenue.body.error.code).toBe('banquet.venue_requires_branch');

    const dish = ctx.fakes.menu.add({ name: 'Бешбармак', price: 500_000 });
    const withoutBranch = await http()
      .post(api(`/admin/banquets/requests/${r.id}/quotes`))
      .set('authorization', w.managerAuth)
      .send({ lines: [{ kind: 'menu', dishId: dish.dishId, quantity: 10 }] });
    expect(withoutBranch.status).toBe(422);
    expect(withoutBranch.body.error.code).toBe('banquet_quote.branch_required');

    const executing = await http().patch(api(`/admin/banquets/requests/${r.id}`)).set('authorization', w.managerAuth).send({ branchId: w.otherBranchId });
    expect(executing.status).toBe(200);
    expect(executing.body).toMatchObject({ branchId: w.otherBranchId, isOffsite: true });
    const search = await http().get(api('/admin/banquets/menu/dishes')).query({ branchId: w.otherBranchId, q: 'беш' }).set('authorization', w.managerAuth);
    expect(search.body).toEqual([expect.objectContaining({ dishId: dish.dishId, price: { amount: 500_000, currency: 'KZT' } })]);
    const quote = await http()
      .post(api(`/admin/banquets/requests/${r.id}/quotes`))
      .set('authorization', w.managerAuth)
      .send({ lines: [{ kind: 'menu', dishId: dish.dishId, quantity: 10 }] });
    expect(quote.status).toBe(201);
    expect(quote.body.branchId).toBe(w.otherBranchId);
    // Первая смета берёт новую заявку в работу.
    const detail = await http().get(api(`/admin/banquets/requests/${r.id}`)).set('authorization', w.managerAuth);
    expect(detail.body.status).toBe('in_progress');
  });

  it('reassign manager: RequestAssigned event and notification; only active staff with banquets.manage', async () => {
    const r = await publicRequest(w.branchId);
    const other = await tokenFor(ctx.t, [{ role: StaffRole.BanquetManager }], 'Асель');
    const finance = await tokenFor(ctx.t, [{ role: StaffRole.Finance }], 'Финансы 2');

    const invalid = await http().post(api(`/admin/banquets/requests/${r.id}/assign`)).set('authorization', w.managerAuth).send({ managerId: finance.userId });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('banquet.manager_invalid');

    const res = await http().post(api(`/admin/banquets/requests/${r.id}/assign`)).set('authorization', w.managerAuth).send({ managerId: other.userId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ managerId: other.userId, managerName: 'Асель' });
    const events = await publishedEvents(ctx.t, BanquetEvents.RequestAssigned);
    expect(events.map((e) => e.payload)).toEqual([
      expect.objectContaining({ requestId: r.id, managerId: other.userId, previousManagerId: w.managerId, branchId: w.branchId }),
    ]);
    expect(ctx.fakes.notifier.staff.find((s) => s.template === 'staff.banquet_assigned')?.audience).toMatchObject({ userIds: [other.userId] });

    const managers = await http().get(api('/admin/banquets/managers')).set('authorization', w.managerAuth);
    expect(managers.body.find((m: any) => m.id === other.userId)).toMatchObject({ openRequests: 1 });
    expect(managers.body.find((m: any) => m.id === w.managerId)).toMatchObject({ openRequests: 0 });

    const note = await http().post(api(`/admin/banquets/requests/${r.id}/activities`)).set('authorization', w.managerAuth).send({ kind: 'note' });
    expect(note.status).toBe(422);
  });

  it('funnel rules: quote_sent -> in_progress -> quote_sent (new version); quote accept only from quote_sent', async () => {
    const r = await requestWithSentQuote(ctx, w);
    const back = await http().post(api(`/admin/banquets/requests/${r.id}/transition`)).set('authorization', w.managerAuth).send({ to: 'in_progress', reason: 'Клиент просит другое меню' });
    expect(back.status).toBe(200);
    const page = await http().get(api(`/public/banquets/quotes/${r.token}`));
    expect(page.body).toMatchObject({ canAccept: false, version: 1 });
    const acceptNow = await http().post(api(`/public/banquets/quotes/${r.token}/accept`)).send({ version: 1 });
    expect(acceptNow.status).toBe(409);
    expect(acceptNow.body.error.code).toBe('banquet_quote.not_awaiting_acceptance');

    const invalid = await http().post(api(`/admin/banquets/requests/${r.id}/transition`)).set('authorization', w.managerAuth).send({ to: 'held' });
    expect(invalid.status).toBe(409);
    expect(invalid.body.error.code).toBe('banquet.invalid_transition');

    const v2 = await http()
      .post(api(`/admin/banquets/requests/${r.id}/quotes`))
      .set('authorization', w.managerAuth)
      .send({ lines: [{ kind: 'service', title: { ru: 'Обслуживание' }, unit: 'усл.', unitPrice: { amount: 10_000_000 }, quantity: 1 }] });
    expect(v2.body.version).toBe(2);
    const resend = await http().post(api(`/admin/banquets/requests/${r.id}/transition`)).set('authorization', w.managerAuth).send({ to: 'quote_sent' });
    expect(resend.status).toBe(200);
    expect(resend.body.quotes[0]).toMatchObject({ version: 2, isLatest: true });
    expect(resend.body.quotes[0].sentAt).toBeTruthy();
    const again = await http().post(api(`/admin/banquets/quotes/${v2.body.id}/send`)).set('authorization', w.managerAuth);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('banquet_quote.already_sent');

    // Смета истекла — согласовать нельзя.
    ctx.t.clock.set(new Date('2026-10-20T06:00:00Z'));
    const expired = await http().post(api(`/public/banquets/quotes/${r.token}/accept`)).send({ version: 2 });
    expect(expired.status).toBe(422);
    expect(expired.body.error.code).toBe('banquet_quote.expired');
    expect((await http().get(api('/public/banquets/quotes/unknown-token'))).status).toBe(404);
  });

  it('companies: CRUD, duplicate BIN, search; contract templates and contract generation', async () => {
    const bad = await http().post(api('/admin/banquets/companies')).set('authorization', w.managerAuth).send({ name: 'ТОО', bin: '12345', legalAddress: 'Астана' });
    expect(bad.status).toBe(400);
    const badIban = await http()
      .post(api('/admin/banquets/companies'))
      .set('authorization', w.managerAuth)
      .send({ name: 'ТОО', bin: '123456789012', legalAddress: 'Астана', iban: 'DE12' });
    expect(badIban.status).toBe(422);
    expect(badIban.body.error.code).toBe('banquet_company.invalid_iban');
    const created = await http()
      .post(api('/admin/banquets/companies'))
      .set('authorization', w.financeAuth)
      .send({ name: 'ТОО «Ромашка»', bin: '9401 4000 1234', legalAddress: 'Астана, ул. Кенесары 1', directorName: 'Петров П.П.', directorPosition: 'Директор', actingBasis: 'Устава' });
    expect(created.status).toBe(201);
    expect(created.body.bin).toBe('940140001234');
    const dup = await http().post(api('/admin/banquets/companies')).set('authorization', w.managerAuth).send({ name: 'Другая', bin: '940140001234', legalAddress: 'Астана' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('banquet_company.duplicate_bin');
    const found = await http().get(api('/admin/banquets/companies')).query({ q: 'ромаш' }).set('authorization', w.managerAuth);
    expect(found.body.items.map((c: any) => c.id)).toEqual([created.body.id]);
    expect((await http().get(api('/admin/banquets/companies')).query({ q: '94014' }).set('authorization', w.managerAuth)).body.total).toBe(1);
    const updated = await http()
      .put(api(`/admin/banquets/companies/${created.body.id}`))
      .set('authorization', w.managerAuth)
      .send({ name: 'ТОО «Ромашка Плюс»', bin: '940140001234', legalAddress: 'Астана, ул. Кенесары 2' });
    expect(updated.body.name).toBe('ТОО «Ромашка Плюс»');
    const operator = await tokenFor(ctx.t, [{ role: StaffRole.BranchOperator, branchId: w.branchId }]);
    expect((await http().get(api('/admin/banquets/companies')).set('authorization', operator.auth)).status).toBe(403);

    // Шаблоны договоров.
    const typo = await http()
      .post(api('/admin/banquets/contract-templates'))
      .set('authorization', w.managerAuth)
      .send({ code: 'bad', name: 'Опечатка', body: 'Договор {{contract.number}} с {{client.nmae}}' });
    expect(typo.status).toBe(422);
    expect(typo.body.error.code).toBe('banquet_template.unknown_placeholders');
    expect(typo.body.error.details.unknown).toEqual(['client.nmae']);
    const financeTemplate = await http()
      .post(api('/admin/banquets/contract-templates'))
      .set('authorization', w.financeAuth)
      .send({ code: 'fin', name: 'Финансы', body: DEFAULT_CONTRACT_TEMPLATE });
    expect(financeTemplate.status).toBe(403);
    const template = await http()
      .post(api('/admin/banquets/contract-templates'))
      .set('authorization', w.ownerAuth)
      .send({ code: DEFAULT_CONTRACT_TEMPLATE_CODE, name: 'Договор на банкетное обслуживание', body: DEFAULT_CONTRACT_TEMPLATE });
    expect(template.status).toBe(201);
    expect(template.body.isDefault).toBe(true);
    const second = await http()
      .post(api('/admin/banquets/contract-templates'))
      .set('authorization', w.managerAuth)
      .send({ code: 'short', name: 'Короткий', body: 'Договор № {{contract.number}} от {{contract.date}}: {{client.name}}, {{quote.total}}', isDefault: true });
    expect(second.body.isDefault).toBe(true);
    const templates = await http().get(api('/admin/banquets/contract-templates')).set('authorization', w.managerAuth);
    expect(templates.body.filter((t: any) => t.isDefault).map((t: any) => t.code)).toEqual(['short']);
    const placeholders = await http().get(api('/admin/banquets/contract-templates/placeholders')).set('authorization', w.managerAuth);
    expect(placeholders.body.map((p: any) => p.key)).toEqual(expect.arrayContaining(['seller.name', 'client.bin', 'event.date', 'quote.total']));

    // Договор по заявке юрлица.
    const r = await requestWithSentQuote(ctx, w);
    await http().patch(api(`/admin/banquets/requests/${r.id}`)).set('authorization', w.managerAuth).send({ companyId: created.body.id });
    const contract = await http()
      .post(api(`/admin/banquets/requests/${r.id}/contract`))
      .set('authorization', w.managerAuth)
      .send({ templateId: template.body.id });
    expect(contract.status).toBe(201);
    expect(contract.body).toMatchObject({ kind: 'contract', title: expect.stringContaining('Договор') });
    expect(contract.body.number).toMatch(/^GL-D-2026-\d{6}$/);
    const regenerated = await http().post(api(`/admin/banquets/requests/${r.id}/contract`)).set('authorization', w.managerAuth).send({});
    expect(regenerated.body.number).toBe(contract.body.number);
    const docs = await http().get(api(`/admin/banquets/requests/${r.id}/documents`)).set('authorization', w.managerAuth);
    expect(docs.body.filter((d: any) => d.kind === 'contract')).toHaveLength(2);
    const link = await http().get(api(`/admin/banquets/documents/${contract.body.id}/link`)).set('authorization', w.managerAuth);
    expect(link.body.url).toContain(`banquet/${r.id}/contract-`);
    const file = [...ctx.storage.files.entries()].find(([k]) => k.includes('/contract-'))!;
    expect(file[1].body.subarray(0, 4).toString()).toBe('%PDF');
    const detail = await http().get(api(`/admin/banquets/requests/${r.id}`)).set('authorization', w.managerAuth);
    expect(detail.body).toMatchObject({ contractNumber: contract.body.number, contractDate: '2026-10-01', company: { id: created.body.id } });

    expect((await http().delete(api(`/admin/banquets/contract-templates/${second.body.id}`)).set('authorization', w.managerAuth)).status).toBe(204);
    expect((await http().delete(api(`/admin/banquets/companies/${created.body.id}`)).set('authorization', w.managerAuth)).status).toBe(204);
    expect((await http().get(api(`/admin/banquets/companies/${created.body.id}`)).set('authorization', w.managerAuth)).status).toBe(404);
  });

  it('always a responsible manager: owner when there are no active banquet managers', async () => {
    await resetBanquet(ctx);
    const legalEntityId = await createLegalEntity(ctx.t);
    const branchId = await createBranch(ctx.t, { code: 'GL', slug: 'greenline', legalEntityId });
    const owner = await tokenFor(ctx.t, [{ role: StaffRole.Owner }], 'Единственный собственник');
    const res = await http().post(api('/public/banquets/requests')).send(publicRequestBody(branchId));
    expect(res.status).toBe(201);
    expect(res.body.managerName).toBe('Единственный собственник');
    const list = await http().get(api('/admin/banquets/requests')).set('authorization', owner.auth);
    expect(list.body.items[0].managerId).toBe(owner.userId);
  });

  it('customer anonymization clears contact snapshots in requests', async () => {
    const r = await publicRequest(w.branchId);
    const customerId = [...ctx.fakes.customers.customers.values()][0]!.id;
    await ctx.t.get(EventBus).publish(CustomersEvents.CustomerAnonymized, { customerId, occurredAt: ctx.t.clock.now().toISOString() });
    await ctx.t.drain();
    const detail = await http().get(api(`/admin/banquets/requests/${r.id}`)).set('authorization', w.managerAuth);
    expect(detail.body.contact).toMatchObject({ customerId, name: 'Гость (обезличен)', phone: '', email: null });
    expect(detail.body.wishes).toBeNull();
  });

  it('public helpers: event types with translations, rate-limited form, ESF adapters in the integration catalog', async () => {
    const types = await http().get(api('/public/banquets/event-types')).query({ locale: 'kk' });
    expect(types.body.find((t: any) => t.code === 'memorial')).toEqual({ code: 'memorial', label: 'Еске алу' });
    expect(types.body.map((t: any) => t.code)).toContain('kudalyk');
    const keys = ctx.t.get(IntegrationCatalog).list().map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(['banquet.esf_manual', 'banquet.esf_isesf']));

    const invalid = await http().post(api('/public/banquets/requests')).send(publicRequestBody(w.branchId, { eventType: 'party' }));
    expect(invalid.status).toBe(400);
    const past = await http().post(api('/public/banquets/requests')).send(publicRequestBody(w.branchId, { eventDate: '2026-09-01' }));
    expect(past.status).toBe(422);
    expect(past.body.error.code).toBe('banquet.event_date_in_past');
    const unknownBranch = await http().post(api('/public/banquets/requests')).send(publicRequestBody('01926f00-0000-7000-8000-000000000000'));
    expect(unknownBranch.status).toBe(422);
    expect(unknownBranch.body.error.code).toBe('banquet.unknown_branch');
  });
});
