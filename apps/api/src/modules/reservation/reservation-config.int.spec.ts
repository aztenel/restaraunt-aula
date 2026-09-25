import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Fakes } from '../../../test/fakes';
import { createBranch, tokenFor } from '../../../test/support/fixtures';
import { TestApp } from '../../../test/support/test-app';
import { newId } from '../../shared/kernel/ids';
import { zonedTimeToUtc } from '../../shared/kernel/time';
import { seedReservation } from './infrastructure/seed';
import { auditActions, book, bookingBody, createLayout, createReservationTestApp, resetFakes, seedVenueTypes } from './testing/reservation-test-kit';

const ADMIN = '/api/v1/admin';

const RULES = {
  durationMinutes: 150,
  holdMinutes: 20,
  cancellationDeadlineHours: 12,
  requiresManualConfirmation: false,
  cleanupMinutes: 20,
  slotStepMinutes: 15,
  bookableOnline: true,
};

async function png(width = 800, height = 500): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 120, g: 80, b: 40 } } })
    .png()
    .toBuffer();
}

describe('Reservation: halls, venue types, venues, settings (integration)', () => {
  let t: TestApp;
  let fakes: Fakes;
  let owner: string;
  let branchId: string;
  let otherBranchId: string;
  let managerA: string;
  let operatorA: string;

  beforeAll(async () => {
    ({ t, fakes } = await createReservationTestApp());
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    resetFakes(fakes);
    t.clock.set(zonedTimeToUtc('2026-10-01', '11:00', 'Asia/Almaty'));
    branchId = await createBranch(t);
    otherBranchId = await createBranch(t);
    ({ auth: owner } = await tokenFor(t, [{ role: 'owner' }]));
    ({ auth: managerA } = await tokenFor(t, [{ role: 'branch_manager', branchId }]));
    ({ auth: operatorA } = await tokenFor(t, [{ role: 'branch_operator', branchId }]));
  });

  const api = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, auth = owner) =>
    t.http()[method](`${ADMIN}${path}`).set('authorization', auth);

  it('venue types: configurable reference (not hardcoded); global venues.manage to change; audited', async () => {
    const created = await api('post', '/venue-types').send({ code: 'Gazebo', name: { ru: 'Беседка', kk: 'Шатыр' }, rules: RULES, sortOrder: 50 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: 'gazebo', name: { ru: 'Беседка', kk: 'Шатыр' }, rules: RULES, isActive: true });
    const id = created.body.id;

    const dup = await api('post', '/venue-types').send({ code: 'gazebo', name: { ru: 'Беседка' }, rules: RULES });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('reservation.venue_type_duplicate');
    expect((await api('post', '/venue-types').send({ code: 'x', name: { ru: 'X' }, rules: RULES })).body.error.code).toBe('reservation.invalid_type_code');
    expect((await api('post', '/venue-types').send({ code: 'ok_code', name: { en: 'Only en' }, rules: RULES })).body.error.code).toBe(
      'translatable.required',
    );
    expect((await api('post', '/venue-types').send({ code: 'ok_code', name: { ru: 'X' }, rules: { ...RULES, cleanupMinutes: 5000 } })).status).toBe(400);

    const updated = await api('patch', `/venue-types/${id}`).send({ rules: { cancellationDeadlineHours: 48 }, isActive: false });
    expect(updated.body).toMatchObject({ rules: { ...RULES, cancellationDeadlineHours: 48 }, isActive: false });
    expect((await auditActions(t, id)).map((a) => a.action)).toEqual(['reservation.venue_type_created', 'reservation.venue_type_updated']);

    // Управляющий филиалом ведёт залы своего филиала, но не общий справочник.
    expect((await api('get', '/venue-types', managerA)).status).toBe(200);
    const forbidden = await api('post', '/venue-types', managerA).send({ code: 'other', name: { ru: 'X' }, rules: RULES });
    expect(forbidden.status).toBe(403);
    expect((await api('get', '/venue-types', operatorA)).status).toBe(200);

    expect((await api('delete', `/venue-types/${id}`)).status).toBe(204);
    expect((await api('get', `/venue-types/${id}`)).status).toBe(404);
  });

  it('halls and venues: CRUD with validation, positions inside the plan, branch scoping, delete rules', async () => {
    const types = await seedVenueTypes(t);
    const hall = await api('post', '/halls', managerA).send({ branchId, code: 'Main', name: { ru: 'Основной зал' }, planWidth: 800, planHeight: 500 });
    expect(hall.status).toBe(201);
    expect(hall.body).toMatchObject({ branchId, code: 'main', planWidth: 800, planHeight: 500, background: null, isActive: true });
    const hallId = hall.body.id;
    expect((await api('post', '/halls', managerA).send({ branchId, code: 'main', name: { ru: 'Дубль' } })).body.error.code).toBe('reservation.hall_duplicate');
    expect((await api('post', '/halls', managerA).send({ branchId: otherBranchId, code: 'main', name: { ru: 'Чужой' } })).status).toBe(403);
    expect((await api('post', '/halls').send({ branchId: newId(), code: 'x1', name: { ru: 'X' } })).status).toBe(404);

    const venue = await api('post', '/venues', managerA).send({
      hallId,
      typeId: types.vip_hall,
      code: 'VIP-1',
      name: { ru: 'VIP-зал', kk: 'VIP-зал' },
      description: { ru: 'Караоке, отдельный вход' },
      capacityMin: 6,
      capacityMax: 14,
      deposit: { amount: 5_000_000 },
      rules: { cancellationDeadlineHours: 48, cleanupMinutes: null },
      position: { x: 100, y: 100, w: 300, h: 200, shape: 'rect', rotation: 90 },
    });
    expect(venue.status).toBe(201);
    expect(venue.body).toMatchObject({
      branchId,
      hallId,
      typeCode: 'vip_hall',
      code: 'VIP-1',
      capacityMin: 6,
      capacityMax: 14,
      deposit: { amount: 5_000_000, currency: 'KZT' },
      ruleOverrides: { cancellationDeadlineHours: 48 },
      rules: { cancellationDeadlineHours: 48, cleanupMinutes: 30, durationMinutes: 180 },
      position: { x: 100, y: 100, w: 300, h: 200, shape: 'rect', rotation: 90 },
      photos: [],
      isBookable: true,
    });
    const venueId = venue.body.id;

    const invalid: Array<[Record<string, unknown>, number, string?]> = [
      [{ capacityMin: 10, capacityMax: 4 }, 422, 'reservation.invalid_capacity'],
      [{ position: { x: 700, y: 0, w: 200, h: 100 } }, 422, 'reservation.position_outside_plan'],
      [{ deposit: { amount: 0 } }, 422, 'reservation.invalid_deposit'],
      [{ typeId: newId() }, 422, 'reservation.unknown_venue_type'],
      [{ deposit: { amount: 100.5 } }, 400],
      [{ rules: { depositPercent: 10 } }, 400],
    ];
    for (const [patch, status, code] of invalid) {
      const res = await api('patch', `/venues/${venueId}`, managerA).send(patch);
      expect(res.status, JSON.stringify(patch)).toBe(status);
      if (code) expect(res.body.error.code).toBe(code);
    }
    const moved = await api('patch', `/venues/${venueId}`, managerA).send({ deposit: null, rules: null, position: { x: 450 } });
    expect(moved.body).toMatchObject({ deposit: null, ruleOverrides: {}, position: { x: 450, y: 100 }, rules: { cancellationDeadlineHours: 24 } });
    expect((await api('patch', `/halls/${hallId}`, managerA).send({ planWidth: 700 })).body.error.code).toBe('reservation.plan_too_small');

    // Оператор видит карту зала, но не меняет её; чужой филиал — 403.
    expect((await api('get', `/venues?branchId=${branchId}`, operatorA)).body).toHaveLength(1);
    expect((await api('get', `/halls/${hallId}`, operatorA)).status).toBe(200);
    expect((await api('patch', `/venues/${venueId}`, operatorA).send({ sortOrder: 1 })).status).toBe(403);
    expect((await api('get', `/venues?branchId=${otherBranchId}`, managerA)).status).toBe(403);
    expect((await api('get', '/venues', managerA)).body.map((v: { id: string }) => v.id)).toEqual([venueId]);

    // Удаление: зал с местами — нельзя; место с предстоящей бронью — нельзя.
    expect((await api('delete', `/halls/${hallId}`, managerA)).body.error.code).toBe('reservation.hall_not_empty');
    expect((await api('delete', `/venue-types/${types.vip_hall}`)).body.error.code).toBe('reservation.venue_type_in_use');
    const actions = (await auditActions(t, venueId)).map((a) => a.action);
    expect(actions).toEqual(['reservation.venue_created', 'reservation.venue_updated']);
  });

  it('venue with upcoming reservations cannot be deleted; without them it is soft-deleted', async () => {
    const layout = await createLayout(t);
    await book(t, bookingBody(layout));
    const res = await api('delete', `/venues/${layout.table4}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('reservation.venue_has_reservations');
    expect((await api('delete', `/venues/${layout.table6}`)).status).toBe(204);
    expect((await api('get', `/venues/${layout.table6}`)).status).toBe(404);
    // Деактивированное место на витрине не бронируется.
    await api('patch', `/venues/${layout.vip}`).send({ isActive: false });
    const denied = await book(t, bookingBody(layout, { venueId: layout.vip, guests: 8 }), 422);
    expect(denied.error.code).toBe('reservation.venue_unavailable');
  });

  it('photos and hall background: upload -> webp variants in public storage, delete; limits', async () => {
    const layout = await createLayout(t);
    const up = await api('post', `/venues/${layout.vip}/photos`).attach('file', await png(1000, 600), { filename: 'vip.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect(up.body.photos).toHaveLength(1);
    const photo = up.body.photos[0];
    expect(photo.variants.map((v: { width: number }) => v.width)).toEqual([400, 800]);
    expect(photo.url).toMatch(/\/files\/public\/reservation\/venues\/.+-800\.webp$/);
    expect(photo.thumbnailUrl).toMatch(/-400\.webp$/);

    const bad = await api('post', `/venues/${layout.vip}/photos`).attach('file', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('reservation.image_invalid');
    const gif = await api('post', `/venues/${layout.vip}/photos`).attach('file', Buffer.from('GIF89a'), { filename: 'x.gif', contentType: 'image/gif' });
    expect(gif.body.error.code).toBe('reservation.image_invalid_type');
    expect((await api('post', `/venues/${layout.vip}/photos`)).body.error.code).toBe('reservation.image_required');

    const removed = await api('delete', `/venues/${layout.vip}/photos/${photo.id}`);
    expect(removed.body.photos).toEqual([]);
    expect((await api('delete', `/venues/${layout.vip}/photos/${photo.id}`)).status).toBe(404);

    const bg = await api('put', `/halls/${layout.hallId}/background`).attach('file', await png(1600, 900), { filename: 'plan.png', contentType: 'image/png' });
    expect(bg.status).toBe(200);
    expect(bg.body.background.variants.map((v: { width: number }) => v.width)).toEqual([1200]);
    const map = await t.http().get(`/api/v1/public/branches/${layout.branchSlug}/halls`);
    expect(map.body.halls[0].background.url).toBe(bg.body.background.url);
    expect((await api('delete', `/halls/${layout.hallId}/background`)).body.background).toBeNull();
    expect((await auditActions(t, layout.hallId)).map((a) => a.action)).toEqual(
      expect.arrayContaining(['reservation.hall_background_set', 'reservation.hall_background_removed']),
    );
  });

  it('branch reservation settings: defaults, update with validation and audit, applied to booking', async () => {
    const layout = await createLayout(t);
    const defaults = await api('get', `/reservation-settings/${layout.branchId}`, operatorA);
    expect(defaults.status).toBe(403); // оператор другого филиала
    const read = await api('get', `/reservation-settings/${layout.branchId}`);
    expect(read.body).toMatchObject({ reminderHoursBefore: 3, minLeadMinutes: 60, maxDaysAhead: 60, policyText: {}, updatedAt: null });

    const put = await api('put', `/reservation-settings/${layout.branchId}`).send({
      reminderHoursBefore: 24,
      minLeadMinutes: 0,
      maxDaysAhead: 7,
      policyText: { ru: 'Опоздание более 15 минут — бронь снимается' },
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ reminderHoursBefore: 24, minLeadMinutes: 0, maxDaysAhead: 7 });
    expect((await api('put', `/reservation-settings/${layout.branchId}`).send({ reminderHoursBefore: 100 })).status).toBe(400);
    expect((await api('put', `/reservation-settings/${newId()}`).send({ reminderHoursBefore: 1 })).status).toBe(404);
    expect((await auditActions(t, layout.branchId)).map((a) => a.action)).toContain('reservation.settings_updated');

    // Без упреждения — можно на ближайший час; горизонт 7 дней.
    const soon = await book(t, bookingBody(layout, { date: '2026-10-01', time: '11:30' }));
    expect(soon.policy.text).toBe('Опоздание более 15 минут — бронь снимается');
    expect((await book(t, bookingBody(layout, { date: '2026-10-10' }), 422)).error.code).toBe('reservation.slot_too_far');
  });

  it('seed: venue types always; demo halls and venues for both branches; idempotent', async () => {
    const greenline = await createBranch(t, { slug: 'greenline' });
    const garden = await createBranch(t, { slug: 'garden-view' });
    const ctx = {
      app: t.app,
      branches: { greenline, 'garden-view': garden },
      legalEntityId: newId(),
      ownerUserId: newId(),
      demo: false,
      log: () => undefined,
    };
    await seedReservation(ctx);
    const types = await api('get', '/venue-types');
    expect(types.body.map((x: { code: string }) => x.code)).toEqual(['table', 'vip_hall', 'yurt', 'terrace']);
    expect((await api('get', '/venues')).body).toHaveLength(0);

    await seedReservation({ ...ctx, demo: true });
    await seedReservation({ ...ctx, demo: true });
    for (const id of [greenline, garden]) {
      const venues = (await api('get', `/venues?branchId=${id}`)).body as Array<{
        typeCode: string;
        capacityMax: number;
        deposit: { amount: number } | null;
      }>;
      expect(venues).toHaveLength(11);
      const tables = venues.filter((v) => v.typeCode === 'table');
      expect([...new Set(tables.map((v) => v.capacityMax))].sort()).toEqual([2, 4, 6]);
      expect(venues.filter((v) => v.typeCode === 'vip_hall').map((v) => v.deposit?.amount)).toEqual([5_000_000, 5_000_000]);
      expect(venues.filter((v) => v.typeCode === 'yurt').map((v) => [v.capacityMax, v.deposit?.amount])).toEqual([[20, 10_000_000]]);
      expect((await api('get', `/halls?branchId=${id}`)).body.map((h: { code: string }) => h.code)).toEqual(['main', 'vip', 'yurt']);
    }
    expect((await api('get', '/venue-types')).body).toHaveLength(4);
  });
});
