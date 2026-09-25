import { describe, expect, it } from 'vitest';
import { Money } from '../../../../../shared/kernel/money';
import { CourierClaimRequest } from '../../../domain/courier-dispatch';
import {
  buildCreateClaimBody,
  decimalToMinor,
  mapClaimStatus,
  minorToDecimal,
  parseClaim,
  parseCourierPhone,
  parseTrackingLink,
} from './yandex-delivery.payload';
import { YandexDeliverySettings } from './yandex-delivery.settings';

const settings: YandexDeliverySettings = {
  token: 't',
  baseUrl: 'https://b2b.taxi.yandex.net',
  taxiClass: 'express',
  emergencyContactName: 'AULA',
  emergencyContactPhone: null,
  timeoutMs: 15_000,
};

const request: CourierClaimRequest = {
  dispatchId: 'd1',
  orderId: 'o1',
  orderNumber: 'GL-2026-000001',
  branchId: 'b1',
  pickup: { name: 'AULA GreenLine', phone: '+77172000000', address: 'Астана, E-899 1/1', location: { lat: 51.0762, lng: 71.4125 } },
  dropoff: {
    name: 'Айгерим',
    phone: '+77011234567',
    address: 'Астана, ул. Сыганак, 10',
    location: { lat: 51.1, lng: 71.42 },
    apartment: '25',
    entrance: '2',
    floor: '5',
    intercom: '25К',
    comment: 'Позвонить за 5 минут',
  },
  items: [{ title: 'Плов', quantity: 2, unitPrice: Money.of(350_050) }],
  total: Money.of(700_100),
  collectOnDelivery: Money.of(700_100),
  contactless: false,
  dueAt: new Date('2026-10-01T14:00:00.000Z'),
  comment: 'Без лука',
};

describe('courier service payload', () => {
  it('maps claim statuses, unknown ones keep polling', () => {
    expect(mapClaimStatus('new')).toBe('estimating');
    expect(mapClaimStatus('ready_for_approval')).toBe('awaiting_confirmation');
    expect(mapClaimStatus('performer_lookup')).toBe('searching');
    expect(mapClaimStatus('performer_found')).toBe('courier_assigned');
    expect(mapClaimStatus('pickuped')).toBe('picked_up');
    expect(mapClaimStatus('delivered_finish')).toBe('delivered');
    expect(mapClaimStatus('returned_finish')).toBe('failed');
    expect(mapClaimStatus('cancelled_by_taxi')).toBe('cancelled');
    expect(mapClaimStatus('something_new')).toBe('searching');
  });

  it('converts money without floats', () => {
    expect(minorToDecimal(Money.of(350_050))).toBe('3500.50');
    expect(minorToDecimal(Money.of(5))).toBe('0.05');
    expect(decimalToMinor('850.00')?.amount).toBe(85_000);
    expect(decimalToMinor('850.5')?.amount).toBe(85_050);
    expect(decimalToMinor('850')?.amount).toBe(85_000);
    expect(decimalToMinor(850)?.amount).toBe(85_000);
    expect(decimalToMinor('abc')).toBeNull();
    expect(decimalToMinor(undefined)).toBeNull();
  });

  it('builds the claim: route points with [lng, lat], items, contacts, due time and payment note', () => {
    const body = buildCreateClaimBody(request, settings) as any;
    expect(body.items).toEqual([{ pickup_point: 1, droppof_point: 2, title: 'Плов', cost_value: '3500.50', cost_currency: 'KZT', quantity: 2 }]);
    expect(body.route_points[0]).toMatchObject({ type: 'source', address: { coordinates: [71.4125, 51.0762] }, contact: { phone: '+77172000000' } });
    expect(body.route_points[1]).toMatchObject({
      type: 'destination',
      external_order_id: 'GL-2026-000001',
      address: { coordinates: [71.42, 51.1], sflat: '25', porch: '2', sfloor: '5', door_code: '25К', comment: 'Позвонить за 5 минут' },
    });
    expect(body.emergency_contact).toEqual({ name: 'AULA', phone: '+77172000000' });
    expect(body.client_requirements).toEqual({ taxi_class: 'express' });
    expect(body.due).toBe('2026-10-01T14:00:00.000Z');
    expect(body.comment).toContain('Оплата при получении');
    expect(body.comment).toContain('Без лука');
    const paid = buildCreateClaimBody({ ...request, collectOnDelivery: null, dueAt: null, contactless: true }, settings) as any;
    expect(paid.due).toBeUndefined();
    expect(paid.skip_door_to_door).toBe(true);
    expect(paid.comment).toContain('Заказ оплачен');
  });

  it('parses claim info, tracking link and courier phone', () => {
    const claim = parseClaim({ id: 'c1', status: 'performer_found', version: 3, pricing: { final_price: '850.00' }, performer_info: { courier_name: 'Ерлан' } });
    expect(claim).toMatchObject({ id: 'c1', version: 3, info: { status: 'courier_assigned', courierName: 'Ерлан', price: Money.of(85_000) } });
    expect(parseClaim({ id: 'c1', status: 'new', pricing: { offer: { price: '300' } } }).info.price?.amount).toBe(30_000);
    expect(() => parseClaim({})).toThrow();
    expect(parseTrackingLink({ route_points: [{ type: 'source' }, { type: 'destination', sharing_link: 'https://t.example/abc' }] })).toBe('https://t.example/abc');
    expect(parseTrackingLink({ sharing_link: 'javascript:alert(1)' })).toBeNull();
    expect(parseCourierPhone({ phone: '+77001112233', ext: '123' })).toBe('+77001112233 доб. 123');
    expect(parseCourierPhone({})).toBeNull();
  });
});
