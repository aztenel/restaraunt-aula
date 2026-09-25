import { ModuleSeeder } from '../../../shared/infrastructure/seed/seed.types';
import { Actor } from '../../../shared/kernel/actor';
import { Money } from '../../../shared/kernel/money';
import { Translatable } from '../../../shared/kernel/translatable';
import { CreateHall } from '../application/hall.actions';
import { CreateVenueType, VenueTypeInput } from '../application/venue-type.actions';
import { CreateVenue } from '../application/venue.actions';
import { VenuePosition } from '../domain/venue';
import { HallRepository } from './hall.repository';
import { VenueTypeRepository } from './venue-type.repository';
import { VenueRepository } from './venue.repository';

/**
 * Справочник типов мест (стартовые данные; правила — гипотезы, редактируются в админке).
 * Стол — без депозита и ручного подтверждения; VIP-зал — депозит, отмена за сутки; юрта — депозит,
 * ручное подтверждение персоналом, отмена за двое суток; терраса — сезонная посадка.
 */
export const DEFAULT_VENUE_TYPES: VenueTypeInput[] = [
  {
    code: 'table',
    name: { ru: 'Стол', kk: 'Үстел', en: 'Table' },
    description: { ru: 'Стол в общем зале', kk: 'Жалпы залдағы үстел', en: 'Table in the main hall' },
    rules: {
      durationMinutes: 120,
      holdMinutes: 30,
      cancellationDeadlineHours: 2,
      requiresManualConfirmation: false,
      cleanupMinutes: 15,
      slotStepMinutes: 30,
      bookableOnline: true,
    },
    sortOrder: 10,
  },
  {
    code: 'vip_hall',
    name: { ru: 'VIP-зал', kk: 'VIP-зал', en: 'VIP room' },
    description: { ru: 'Отдельный зал с обслуживанием', kk: 'Қызмет көрсетілетін жеке зал', en: 'Private room with service' },
    rules: {
      durationMinutes: 180,
      holdMinutes: 30,
      cancellationDeadlineHours: 24,
      requiresManualConfirmation: false,
      cleanupMinutes: 30,
      slotStepMinutes: 30,
      bookableOnline: true,
    },
    sortOrder: 20,
  },
  {
    code: 'yurt',
    name: { ru: 'Юрта', kk: 'Киіз үй', en: 'Yurt' },
    description: { ru: 'Юрта для больших компаний', kk: 'Үлкен компанияларға арналған киіз үй', en: 'Yurt for large groups' },
    rules: {
      durationMinutes: 240,
      holdMinutes: 60,
      cancellationDeadlineHours: 48,
      requiresManualConfirmation: true,
      cleanupMinutes: 30,
      slotStepMinutes: 60,
      bookableOnline: true,
    },
    sortOrder: 30,
  },
  {
    code: 'terrace',
    name: { ru: 'Терраса', kk: 'Терраса', en: 'Terrace' },
    description: { ru: 'Летняя терраса (сезон)', kk: 'Жазғы терраса (маусымдық)', en: 'Summer terrace (seasonal)' },
    rules: {
      durationMinutes: 120,
      holdMinutes: 30,
      cancellationDeadlineHours: 2,
      requiresManualConfirmation: false,
      cleanupMinutes: 15,
      slotStepMinutes: 30,
      bookableOnline: true,
    },
    sortOrder: 40,
  },
];

interface DemoVenue {
  code: string;
  type: string;
  name: Translatable;
  capacity: [number, number];
  depositTenge?: number;
  position: VenuePosition;
}

interface DemoHall {
  code: string;
  name: Translatable;
  plan: { width: number; height: number };
  sortOrder: number;
  venues: DemoVenue[];
}

const table = (n: number, capacity: [number, number], position: Omit<VenuePosition, 'rotation'>): DemoVenue => ({
  code: `T${n}`,
  type: 'table',
  name: { ru: `Стол ${n}`, kk: `${n}-үстел`, en: `Table ${n}` },
  capacity,
  position: { ...position, rotation: 0 },
});

/** Демо-планировка филиала: столы на 2/4/6, два VIP-зала (депозит 50 000 ₸), юрта на 20 гостей (депозит 100 000 ₸). */
const DEMO_HALLS: DemoHall[] = [
  {
    code: 'main',
    name: { ru: 'Основной зал', kk: 'Негізгі зал', en: 'Main hall' },
    plan: { width: 1000, height: 600 },
    sortOrder: 10,
    venues: [
      table(1, [1, 2], { x: 60, y: 60, w: 70, h: 70, shape: 'circle' }),
      table(2, [1, 2], { x: 180, y: 60, w: 70, h: 70, shape: 'circle' }),
      table(3, [2, 4], { x: 320, y: 50, w: 110, h: 90, shape: 'rect' }),
      table(4, [2, 4], { x: 480, y: 50, w: 110, h: 90, shape: 'rect' }),
      table(5, [2, 4], { x: 640, y: 50, w: 110, h: 90, shape: 'rect' }),
      table(6, [4, 6], { x: 320, y: 260, w: 160, h: 100, shape: 'rect' }),
      table(7, [4, 6], { x: 540, y: 260, w: 160, h: 100, shape: 'rect' }),
      table(8, [1, 2], { x: 820, y: 460, w: 70, h: 70, shape: 'circle' }),
    ],
  },
  {
    code: 'vip',
    name: { ru: 'VIP-залы', kk: 'VIP-залдар', en: 'VIP rooms' },
    plan: { width: 1000, height: 600 },
    sortOrder: 20,
    venues: [
      {
        code: 'VIP1',
        type: 'vip_hall',
        name: { ru: 'VIP-зал «Алтын»', kk: '«Алтын» VIP-залы', en: 'VIP room "Altyn"' },
        capacity: [6, 12],
        depositTenge: 50_000,
        position: { x: 50, y: 50, w: 400, h: 300, shape: 'rect', rotation: 0 },
      },
      {
        code: 'VIP2',
        type: 'vip_hall',
        name: { ru: 'VIP-зал «Күміс»', kk: '«Күміс» VIP-залы', en: 'VIP room "Kumis"' },
        capacity: [8, 16],
        depositTenge: 50_000,
        position: { x: 520, y: 50, w: 420, h: 300, shape: 'rect', rotation: 0 },
      },
    ],
  },
  {
    code: 'yurt',
    name: { ru: 'Юрта', kk: 'Киіз үй', en: 'Yurt' },
    plan: { width: 800, height: 800 },
    sortOrder: 30,
    venues: [
      {
        code: 'YURT',
        type: 'yurt',
        name: { ru: 'Юрта «Ұлы дала»', kk: '«Ұлы дала» киіз үйі', en: 'Yurt "Uly Dala"' },
        capacity: [10, 20],
        depositTenge: 100_000,
        position: { x: 150, y: 150, w: 500, h: 500, shape: 'circle', rotation: 0 },
      },
    ],
  },
];

/**
 * Стартовые данные Reservation (идемпотентно, поиск по кодам):
 * - всегда: справочник типов мест (стол, VIP-зал, юрта, терраса);
 * - демо: залы и места обоих филиалов с позициями на плане.
 */
export const seedReservation: ModuleSeeder = async (ctx) => {
  const actor = Actor.system('seed');
  const types = ctx.app.get(VenueTypeRepository);
  const createType = ctx.app.get(CreateVenueType);
  let createdTypes = 0;
  for (const type of DEFAULT_VENUE_TYPES) {
    if (await types.findByCode(type.code)) continue;
    await createType.execute(actor, type);
    createdTypes++;
  }
  if (createdTypes > 0) ctx.log(`Типы мест: ${createdTypes}`);
  if (!ctx.demo) return;

  const halls = ctx.app.get(HallRepository);
  const venues = ctx.app.get(VenueRepository);
  const createHall = ctx.app.get(CreateHall);
  const createVenue = ctx.app.get(CreateVenue);
  let createdVenues = 0;
  for (const branchId of Object.values(ctx.branches)) {
    for (const demo of DEMO_HALLS) {
      const hall =
        (await halls.findByCode(branchId, demo.code)) ??
        (await createHall.execute(actor, {
          branchId,
          code: demo.code,
          name: demo.name,
          planWidth: demo.plan.width,
          planHeight: demo.plan.height,
          sortOrder: demo.sortOrder,
        }));
      let order = 0;
      for (const v of demo.venues) {
        order += 10;
        if (await venues.findByCode(branchId, v.code)) continue;
        const type = await types.findByCode(v.type);
        if (!type) continue;
        await createVenue.execute(actor, {
          hallId: hall.id,
          typeId: type.id,
          code: v.code,
          name: v.name,
          capacityMin: v.capacity[0],
          capacityMax: v.capacity[1],
          deposit: v.depositTenge ? Money.tenge(v.depositTenge) : null,
          position: v.position,
          sortOrder: order,
        });
        createdVenues++;
      }
    }
  }
  if (createdVenues > 0) ctx.log(`Демо-места для брони: ${createdVenues}`);
};
