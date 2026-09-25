import { ModuleSeeder } from '../../../shared/infrastructure/seed/seed.types';
import { Actor } from '../../../shared/kernel/actor';
import { GeoPoint, GeoPolygon } from '../../../shared/kernel/geo';
import { Money } from '../../../shared/kernel/money';
import { Translatable } from '../../../shared/kernel/translatable';
import { BranchDirectory } from '../../identity/public';
import { CreateDeliveryZone } from '../application/delivery-zone.actions';
import { CreatePromoCode } from '../application/promo-code.actions';
import { DeliveryZoneDefinition } from '../domain/delivery-zone';
import { DeliveryZoneRepository } from './delivery-zone.repository';
import { PromoCodeRepository } from './promo-code.repository';

/** Полуразмеры прямоугольников зон в градусах (широта ~111 км/°, долгота на 51° с.ш. ~70 км/°). */
const NEAR = { lat: 0.018, lng: 0.028 }; // ~2 км от филиала
const FAR = { lat: 0.045, lng: 0.07 }; // ~5 км от филиала

/** Ближняя зона: прямоугольник вокруг филиала. */
export function nearZonePolygon(c: GeoPoint): GeoPolygon {
  return [
    { lat: c.lat - NEAR.lat, lng: c.lng - NEAR.lng },
    { lat: c.lat - NEAR.lat, lng: c.lng + NEAR.lng },
    { lat: c.lat + NEAR.lat, lng: c.lng + NEAR.lng },
    { lat: c.lat + NEAR.lat, lng: c.lng - NEAR.lng },
  ];
}

/**
 * Дальняя зона: «кольцо» вокруг ближней зоны. Простой полигон без дыр получается разрезом по южной
 * стороне: внешний контур против часовой стрелки, по разрезу внутрь, внутренний контур по часовой, обратно.
 * С ближней зоной только касается по границе — зоны филиала не пересекаются.
 */
export function farZonePolygon(c: GeoPoint): GeoPolygon {
  const sOut = c.lat - FAR.lat;
  const nOut = c.lat + FAR.lat;
  const wOut = c.lng - FAR.lng;
  const eOut = c.lng + FAR.lng;
  const sIn = c.lat - NEAR.lat;
  const nIn = c.lat + NEAR.lat;
  const wIn = c.lng - NEAR.lng;
  const eIn = c.lng + NEAR.lng;
  return [
    { lat: sOut, lng: eOut },
    { lat: nOut, lng: eOut },
    { lat: nOut, lng: wOut },
    { lat: sOut, lng: wOut },
    { lat: sOut, lng: c.lng },
    { lat: sIn, lng: c.lng },
    { lat: sIn, lng: wIn },
    { lat: nIn, lng: wIn },
    { lat: nIn, lng: eIn },
    { lat: sIn, lng: eIn },
    { lat: sIn, lng: c.lng },
    { lat: sOut, lng: c.lng },
  ];
}

const NEAR_NAME: Translatable = { ru: 'Ближняя зона', kk: 'Жақын аймақ', en: 'Near zone' };
const FAR_NAME: Translatable = { ru: 'Дальняя зона', kk: 'Алыс аймақ', en: 'Far zone' };

export function demoZones(location: GeoPoint): DeliveryZoneDefinition[] {
  return [
    {
      name: NEAR_NAME,
      polygon: nearZonePolygon(location),
      minOrderAmount: Money.tenge(3_000),
      deliveryFee: Money.tenge(500),
      freeDeliveryFrom: Money.tenge(10_000),
      etaMinutes: 45,
      isActive: true,
      sortOrder: 10,
    },
    {
      name: FAR_NAME,
      polygon: farZonePolygon(location),
      minOrderAmount: Money.tenge(5_000),
      deliveryFee: Money.tenge(1_000),
      freeDeliveryFrom: Money.tenge(20_000),
      etaMinutes: 75,
      isActive: true,
      sortOrder: 20,
    },
  ];
}

export const WELCOME_PROMO_CODE = 'WELCOME10';

/**
 * Стартовые данные Ordering (идемпотентно). Справочных данных модулю не нужно (служба курьеров по
 * умолчанию — свои курьеры). Демо: по две зоны доставки вокруг обоих филиалов (ближняя дешевле, дальняя
 * дороже, внутри филиала не пересекаются; поиск по названию зоны) и промокод WELCOME10 (10%, 1 раз на телефон).
 */
export const seedOrdering: ModuleSeeder = async (ctx) => {
  if (!ctx.demo) return;
  const actor = Actor.system('seed');
  const branches = ctx.app.get(BranchDirectory);
  const zones = ctx.app.get(DeliveryZoneRepository);
  const createZone = ctx.app.get(CreateDeliveryZone);
  let created = 0;
  for (const slug of ['greenline', 'garden-view']) {
    const branchId = ctx.branches[slug];
    if (!branchId) continue;
    const branch = await branches.find(branchId);
    if (!branch) continue;
    const existing = new Set((await zones.listForBranch(branchId)).map((z) => z.name.ru));
    for (const zone of demoZones(branch.location)) {
      if (existing.has(zone.name.ru)) continue;
      await createZone.execute(actor, branchId, zone);
      created++;
    }
  }
  if (created > 0) ctx.log(`Демо-зоны доставки: ${created}`);

  if (!(await ctx.app.get(PromoCodeRepository).findByCode(WELCOME_PROMO_CODE))) {
    await ctx.app.get(CreatePromoCode).execute(actor, {
      code: WELCOME_PROMO_CODE,
      description: 'Скидка 10% на первый заказ (один раз на номер телефона)',
      kind: 'percent',
      percentBp: 1_000,
      fixedAmount: null,
      minSubtotal: null,
      validFrom: null,
      validTo: null,
      totalLimit: null,
      perPhoneLimit: 1,
      branchId: null,
      isActive: true,
    });
    ctx.log(`Демо-промокод ${WELCOME_PROMO_CODE} создан`);
  }
};
