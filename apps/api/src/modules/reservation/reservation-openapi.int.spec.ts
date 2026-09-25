import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestApp } from '../../../test/support/test-app';
import { buildOpenApiDocument } from '../../shared/infrastructure/http/swagger';
import { createReservationTestApp } from './testing/reservation-test-kit';

/** Типизированный клиент строится по OpenAPI: у каждого маршрута модуля описан ответ и теги. */
describe('Reservation: OpenAPI description (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    ({ t } = await createReservationTestApp());
  });
  afterAll(async () => t.close());

  it('documents every reservation route with tags and typed responses', () => {
    const doc = buildOpenApiDocument(t.app, 'test');
    const expected: Array<[string, string, string]> = [
      ['/api/v1/admin/venue-types', 'get', 'VenueTypeDto'],
      ['/api/v1/admin/venue-types', 'post', 'VenueTypeDto'],
      ['/api/v1/admin/venue-types/{id}', 'get', 'VenueTypeDto'],
      ['/api/v1/admin/venue-types/{id}', 'patch', 'VenueTypeDto'],
      ['/api/v1/admin/venue-types/{id}', 'delete', ''],
      ['/api/v1/admin/halls', 'get', 'HallDto'],
      ['/api/v1/admin/halls', 'post', 'HallDto'],
      ['/api/v1/admin/halls/{id}', 'get', 'HallDto'],
      ['/api/v1/admin/halls/{id}', 'patch', 'HallDto'],
      ['/api/v1/admin/halls/{id}', 'delete', ''],
      ['/api/v1/admin/halls/{id}/background', 'put', 'HallDto'],
      ['/api/v1/admin/halls/{id}/background', 'delete', 'HallDto'],
      ['/api/v1/admin/venues', 'get', 'VenueDto'],
      ['/api/v1/admin/venues', 'post', 'VenueDto'],
      ['/api/v1/admin/venues/{id}', 'get', 'VenueDto'],
      ['/api/v1/admin/venues/{id}', 'patch', 'VenueDto'],
      ['/api/v1/admin/venues/{id}', 'delete', ''],
      ['/api/v1/admin/venues/{id}/photos', 'post', 'VenueDto'],
      ['/api/v1/admin/venues/{id}/photos/{photoId}', 'delete', 'VenueDto'],
      ['/api/v1/admin/reservation-settings/{branchId}', 'get', 'ReservationSettingsDto'],
      ['/api/v1/admin/reservation-settings/{branchId}', 'put', 'ReservationSettingsDto'],
      ['/api/v1/admin/reservations', 'get', 'ReservationsPageDto'],
      ['/api/v1/admin/reservations', 'post', 'ReservationDetailDto'],
      ['/api/v1/admin/reservations/timeline', 'get', 'TimelineDto'],
      ['/api/v1/admin/reservations/{id}', 'get', 'ReservationDetailDto'],
      ['/api/v1/admin/reservations/{id}/confirm', 'post', 'ReservationDetailDto'],
      ['/api/v1/admin/reservations/{id}/cancel', 'post', 'ReservationDetailDto'],
      ['/api/v1/admin/reservations/{id}/arrived', 'post', 'ReservationDetailDto'],
      ['/api/v1/admin/reservations/{id}/no-show', 'post', 'ReservationDetailDto'],
      ['/api/v1/admin/reservations/{id}/reschedule', 'post', 'ReservationDetailDto'],
      ['/api/v1/public/branches/{branchSlug}/reservation-availability', 'get', 'AvailabilityDto'],
      ['/api/v1/public/branches/{branchSlug}/halls', 'get', 'PublicHallMapDto'],
      ['/api/v1/public/reservations', 'post', 'PublicReservationDto'],
      ['/api/v1/public/reservations/{token}', 'get', 'PublicReservationDto'],
      ['/api/v1/public/reservations/{token}/cancel', 'post', 'PublicReservationDto'],
      ['/api/v1/public/reservations/{token}/pay', 'post', 'PublicReservationDto'],
    ];
    for (const [path, method, schema] of expected) {
      const op = (doc.paths[path] as Record<string, { tags?: string[]; responses: Record<string, unknown>; security?: unknown }>)?.[method];
      expect(op, `${method} ${path}`).toBeTruthy();
      expect(op!.tags).toContain(path.includes('/public/') ? 'public' : 'admin');
      if (!path.includes('/public/')) expect(op!.security).toEqual([{ staff: [] }]);
      if (schema) expect(JSON.stringify(op!.responses), `${method} ${path}`).toContain(`#/components/schemas/${schema}`);
    }
    const schemas = doc.components!.schemas! as Record<string, { properties: Record<string, unknown> }>;
    expect(JSON.stringify(schemas.VenueDto!.properties.deposit)).toContain('MoneyDto');
    expect(JSON.stringify(schemas.VenueDto!.properties.name)).toContain('TranslatableDto');
    expect(JSON.stringify(schemas.ReservationDetailDto!.properties.allowedTransitions)).toContain('awaiting_deposit');
    expect(JSON.stringify(schemas.PublicReservationDto!.properties.deposit)).toContain('PublicDepositDto');
    expect(JSON.stringify(schemas.AvailabilityDto!.properties.alternatives)).toContain('AlternativeTimeDto');
  });
});
