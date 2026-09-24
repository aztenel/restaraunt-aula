import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../shared/infrastructure/http/swagger';
import { createPaymentsTestApp, PaymentsTestContext } from './testing/payments-test-kit';

describe('Payments OpenAPI (integration)', () => {
  let ctx: PaymentsTestContext;

  beforeAll(async () => {
    ctx = await createPaymentsTestApp();
  });
  afterAll(async () => ctx.t.close());

  it('describes every endpoint with typed request/response schemas for the generated client', () => {
    const doc = buildOpenApiDocument(ctx.t.app, 'test');
    const paths = Object.keys(doc.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/admin/payments',
        '/api/v1/admin/payments/refunds',
        '/api/v1/admin/payments/{id}',
        '/api/v1/admin/payments/{id}/refunds',
        '/api/v1/admin/payments/{id}/collect',
        '/api/v1/admin/payments/refunds/{refundId}/confirm',
        '/api/v1/admin/payments/refunds/{refundId}/reject',
        '/api/v1/admin/certificates',
        '/api/v1/admin/certificates/products',
        '/api/v1/admin/certificates/products/{id}',
        '/api/v1/admin/certificates/report',
        '/api/v1/admin/certificates/report/export',
        '/api/v1/admin/certificates/check',
        '/api/v1/admin/certificates/redeem',
        '/api/v1/admin/certificates/issue',
        '/api/v1/admin/certificates/{id}',
        '/api/v1/admin/certificates/{id}/pdf-link',
        '/api/v1/admin/certificates/{id}/block',
        '/api/v1/admin/certificates/{id}/unblock',
        '/api/v1/admin/certificates/{id}/extend',
        '/api/v1/admin/certificates/{id}/resend',
        '/api/v1/public/certificates/products',
        '/api/v1/public/certificates/purchase',
        '/api/v1/public/certificates/orders/{token}',
        '/api/v1/public/certificates/check',
        '/api/v1/public/payments/sandbox/{paymentId}',
        '/api/v1/public/payments/{paymentId}/checkout',
        '/api/v1/webhooks/payments/{provider}',
      ]),
    );
    const schemas = doc.components?.schemas ?? {};
    for (const name of ['PaymentDto', 'PaymentsPageDto', 'RefundDto', 'PaymentDetailsDto', 'PurchaseCertificateDto', 'PurchaseResultDto', 'CertificateDto', 'CertificateReportDto']) {
      expect(schemas[name], name).toBeTruthy();
    }
    expect((schemas.PaymentDto as any).properties.amount.$ref).toContain('MoneyDto');
    expect(doc.paths['/api/v1/admin/payments']!.get!.tags).toEqual(['admin']);
    expect(doc.paths['/api/v1/admin/payments']!.get!.security).toEqual([{ staff: [] }]);
    expect(doc.paths['/api/v1/public/certificates/purchase']!.post!.tags).toEqual(['public']);
    expect(doc.paths['/api/v1/webhooks/payments/{provider}']!.post!.tags).toEqual(['webhooks']);
  });
});
