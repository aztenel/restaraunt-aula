import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestApp } from '../../../test/support/test-app';
import { buildOpenApiDocument } from '../../shared/infrastructure/http/swagger';
import { createCustomersTestApp } from './testing/customers-test-kit';

/** Типизированный клиент строится по OpenAPI: у каждого маршрута модуля описан ответ и теги. */
describe('Customers: OpenAPI description (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    ({ t } = await createCustomersTestApp());
  });
  afterAll(async () => t.close());

  it('documents every customers route with tags and typed responses', () => {
    const doc = buildOpenApiDocument(t.app, 'test');
    const expected: Array<[string, string, string]> = [
      ['/api/v1/admin/customers', 'get', 'CustomersPageDto'],
      ['/api/v1/admin/customers/tags', 'get', 'TagStatDto'],
      ['/api/v1/admin/customers/export', 'post', ''],
      ['/api/v1/admin/customers/{id}', 'get', 'CustomerDetailDto'],
      ['/api/v1/admin/customers/{id}', 'patch', 'CustomerDto'],
      ['/api/v1/admin/customers/{id}/consents', 'post', 'CustomerDto'],
      ['/api/v1/admin/customers/{id}/anonymize', 'post', 'CustomerDto'],
      ['/api/v1/admin/customer-segments', 'get', 'SegmentDto'],
      ['/api/v1/admin/customer-segments', 'post', 'SegmentDto'],
      ['/api/v1/admin/customer-segments/{id}', 'get', 'SegmentDetailDto'],
      ['/api/v1/admin/customer-segments/{id}', 'patch', 'SegmentDto'],
      ['/api/v1/admin/customer-segments/{id}', 'delete', ''],
      ['/api/v1/admin/consent-texts', 'get', 'ConsentTextDto'],
      ['/api/v1/admin/consent-texts', 'post', 'ConsentTextDto'],
      ['/api/v1/public/consents/{kind}', 'get', 'PublicConsentTextDto'],
      ['/api/v1/public/phone-verifications', 'post', 'PhoneVerificationStartedDto'],
      ['/api/v1/public/phone-verifications/{id}/verify', 'post', 'PhoneVerifiedDto'],
    ];
    for (const [path, method, schema] of expected) {
      const op = (doc.paths[path] as Record<string, { tags?: string[]; responses: Record<string, unknown>; security?: unknown }>)?.[method];
      expect(op, `${method} ${path}`).toBeTruthy();
      expect(op!.tags).toContain(path.includes('/public/') ? 'public' : 'admin');
      if (!path.includes('/public/')) expect(op!.security).toEqual([{ staff: [] }]);
      const responses = JSON.stringify(op!.responses);
      if (schema) expect(responses, `${method} ${path}`).toContain(`#/components/schemas/${schema}`);
    }
    const exportOp = (doc.paths['/api/v1/admin/customers/export'] as Record<string, { responses: Record<string, unknown> }>).post;
    expect(JSON.stringify(exportOp?.responses)).toContain('binary');
    const customer = doc.components!.schemas!.CustomerDto as { properties: Record<string, unknown> };
    expect(JSON.stringify(customer.properties.totalSpent)).toContain('MoneyDto');
  });
});
