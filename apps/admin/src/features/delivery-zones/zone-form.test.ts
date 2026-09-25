import { describe, expect, it } from 'vitest';
import {
  EMPTY_ZONE_FORM,
  formValuesToCreateInput,
  formValuesToZoneInput,
  latLngsToPolygon,
  polygonToLatLngs,
  rectangleAround,
  validateZoneForm,
  zoneToFormValues,
  type DeliveryZone,
} from './zone-form';

const zone: DeliveryZone = {
  id: 'z1',
  branchId: 'b1',
  name: { ru: 'Центр', kk: 'Орталық' },
  polygon: [
    { lat: 51.13, lng: 71.41 },
    { lat: 51.14, lng: 71.45 },
    { lat: 51.12, lng: 71.46 },
  ],
  minOrderAmount: { amount: 500_000, currency: 'KZT' },
  deliveryFee: { amount: 80_000, currency: 'KZT' },
  freeDeliveryFrom: { amount: 1_500_050, currency: 'KZT' },
  etaMinutes: 45,
  isActive: true,
  sortOrder: 2,
};

describe('полигон зоны: Leaflet ⇄ API', () => {
  it('кольцо Leaflet (LatLng[][]) → точки без замыкающей, с округлением до 6 знаков', () => {
    const latlngs = [
      [
        { lat: 51.1234567891, lng: 71.4000001 },
        { lat: 51.2, lng: 71.5 },
        { lat: 51.2, lng: 71.5 },
        { lat: 51.1, lng: 71.6 },
        { lat: 51.1234567891, lng: 71.4000001 },
      ],
    ];
    expect(latLngsToPolygon(latlngs)).toEqual([
      { lat: 51.123457, lng: 71.4 },
      { lat: 51.2, lng: 71.5 },
      { lat: 51.1, lng: 71.6 },
    ]);
  });

  it('плоский массив и мультиполигон (берётся внешнее кольцо первого)', () => {
    const flat = [
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
      { lat: 5, lng: 6 },
    ];
    expect(latLngsToPolygon(flat)).toEqual(flat);
    expect(latLngsToPolygon([[flat, [{ lat: 9, lng: 9 }]]])).toEqual(flat);
    expect(latLngsToPolygon(null)).toEqual([]);
    expect(latLngsToPolygon([[{ lat: 'x' }]])).toEqual([]);
  });

  it('API → позиции Leaflet [lat, lng] и обратно без потерь', () => {
    const positions = polygonToLatLngs(zone.polygon);
    expect(positions).toEqual([
      [51.13, 71.41],
      [51.14, 71.45],
      [51.12, 71.46],
    ]);
    expect(latLngsToPolygon(positions.map(([lat, lng]) => ({ lat, lng })))).toEqual(zone.polygon);
  });

  it('заготовка-прямоугольник вокруг филиала', () => {
    const rect = rectangleAround({ lat: 51, lng: 71 }, 0.01, 0.02);
    expect(rect).toHaveLength(4);
    expect(rect[0]).toEqual({ lat: 51.01, lng: 70.98 });
    expect(rect[2]).toEqual({ lat: 50.99, lng: 71.02 });
  });
});

describe('форма зоны ⇄ API', () => {
  it('зона → значения формы (суммы в тиынах)', () => {
    expect(zoneToFormValues(zone)).toEqual({
      name: { ru: 'Центр', kk: 'Орталық' },
      minOrderAmount: 500_000,
      deliveryFee: 80_000,
      freeDeliveryFrom: 1_500_050,
      etaMinutes: 45,
      isActive: true,
      sortOrder: 2,
    });
  });

  it('форма → тело PUT: Money с валютой, пустое «бесплатно от» → null, пустые переводы убираются', () => {
    const values = { ...zoneToFormValues(zone), freeDeliveryFrom: null, name: { ru: ' Центр ', kk: '', en: '  ' } };
    expect(formValuesToZoneInput(values, zone.polygon)).toEqual({
      name: { ru: 'Центр' },
      polygon: zone.polygon,
      minOrderAmount: { amount: 500_000, currency: 'KZT' },
      deliveryFee: { amount: 80_000, currency: 'KZT' },
      freeDeliveryFrom: null,
      etaMinutes: 45,
      isActive: true,
      sortOrder: 2,
    });
  });

  it('форма → тело POST содержит филиал; круговой проход сохраняет данные', () => {
    const input = formValuesToCreateInput('b1', zoneToFormValues(zone), zone.polygon);
    expect(input.branchId).toBe('b1');
    expect(input.freeDeliveryFrom).toEqual({ amount: 1_500_050, currency: 'KZT' });
    const back: DeliveryZone = {
      id: 'z1',
      ...input,
      minOrderAmount: { amount: input.minOrderAmount.amount, currency: 'KZT' },
      deliveryFee: { amount: input.deliveryFee.amount, currency: 'KZT' },
      freeDeliveryFrom: input.freeDeliveryFrom ? { amount: input.freeDeliveryFrom.amount, currency: 'KZT' } : null,
    };
    expect(zoneToFormValues(back)).toEqual(zoneToFormValues(zone));
  });

  it('проверка формы: полигон, название, суммы, время доставки', () => {
    expect(validateZoneForm(EMPTY_ZONE_FORM, [])).toEqual({ polygon: 'polygon_required', name: 'name_required' });
    expect(validateZoneForm(zoneToFormValues(zone), zone.polygon)).toEqual({});
    expect(
      validateZoneForm({ ...zoneToFormValues(zone), deliveryFee: null, freeDeliveryFrom: -1, etaMinutes: 601 }, zone.polygon),
    ).toEqual({ deliveryFee: 'amount_required', freeDeliveryFrom: 'amount_negative', etaMinutes: 'eta_invalid' });
    expect(validateZoneForm({ ...zoneToFormValues(zone), etaMinutes: 1.5 }, zone.polygon)).toEqual({ etaMinutes: 'eta_invalid' });
    expect(validateZoneForm(zoneToFormValues(zone), zone.polygon.slice(0, 2))).toEqual({ polygon: 'polygon_required' });
  });
});
