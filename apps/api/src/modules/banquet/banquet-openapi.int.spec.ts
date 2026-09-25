import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../shared/infrastructure/http/swagger';
import { BanquetTestContext, createBanquetTestApp } from './testing/banquet-test-kit';

describe('Banquet OpenAPI (integration)', () => {
  let ctx: BanquetTestContext;

  beforeAll(async () => {
    ctx = await createBanquetTestApp();
  });
  afterAll(async () => ctx.t.close());

  it('describes every endpoint with typed request/response schemas for the generated client', () => {
    const doc = buildOpenApiDocument(ctx.t.app, 'test');
    const paths = Object.keys(doc.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/public/banquets/event-types',
        '/api/v1/public/banquets/requests',
        '/api/v1/public/banquets/quotes/{token}',
        '/api/v1/public/banquets/quotes/{token}/accept',
        '/api/v1/public/banquets/invoices/{token}',
        '/api/v1/public/banquets/invoices/{token}/pay',
        '/api/v1/admin/banquets/requests',
        '/api/v1/admin/banquets/pipeline',
        '/api/v1/admin/banquets/managers',
        '/api/v1/admin/banquets/calendar',
        '/api/v1/admin/banquets/sla-stats',
        '/api/v1/admin/banquets/requests/{id}',
        '/api/v1/admin/banquets/requests/{id}/transition',
        '/api/v1/admin/banquets/requests/{id}/assign',
        '/api/v1/admin/banquets/requests/{id}/activities',
        '/api/v1/admin/banquets/requests/{id}/venue',
        '/api/v1/admin/banquets/requests/{id}/prepayment',
        '/api/v1/admin/banquets/requests/{id}/refunds',
        '/api/v1/admin/banquets/requests/{id}/quotes',
        '/api/v1/admin/banquets/quotes/{quoteId}',
        '/api/v1/admin/banquets/quotes/{quoteId}/pdf',
        '/api/v1/admin/banquets/quotes/{quoteId}/send',
        '/api/v1/admin/banquets/menu/dishes',
        '/api/v1/admin/banquets/invoices',
        '/api/v1/admin/banquets/requests/{id}/invoices',
        '/api/v1/admin/banquets/invoices/{invoiceId}',
        '/api/v1/admin/banquets/invoices/{invoiceId}/pdf',
        '/api/v1/admin/banquets/invoices/{invoiceId}/payments',
        '/api/v1/admin/banquets/invoices/{invoiceId}/cancel',
        '/api/v1/admin/banquets/requests/{id}/documents',
        '/api/v1/admin/banquets/documents/{documentId}/link',
        '/api/v1/admin/banquets/requests/{id}/contract',
        '/api/v1/admin/banquets/requests/{id}/act',
        '/api/v1/admin/banquets/acts/{actId}/esf/retry',
        '/api/v1/admin/banquets/companies',
        '/api/v1/admin/banquets/companies/{id}',
        '/api/v1/admin/banquets/contract-templates',
        '/api/v1/admin/banquets/contract-templates/placeholders',
        '/api/v1/admin/banquets/contract-templates/{id}',
      ]),
    );
    const schemas = doc.components?.schemas ?? {};
    for (const name of [
      'BanquetRequestDetailDto',
      'BanquetRequestsPageDto',
      'BanquetQuoteDto',
      'BanquetInvoiceDto',
      'BanquetInvoicesPageDto',
      'BanquetPublicQuoteDto',
      'BanquetPublicInvoiceDto',
      'BanquetCalendarDto',
      'BanquetSlaStatsDto',
      'BanquetPublicCreateRequestDto',
      'BanquetSaveQuoteDto',
    ]) {
      expect(schemas[name], name).toBeTruthy();
    }
    expect((schemas.BanquetQuoteTotalsDto as any).properties.total.$ref).toContain('MoneyDto');
    expect((schemas.BanquetRequestDetailDto as any).properties.allowedTransitions.items.enum).toContain('quote_sent');
    expect(doc.paths['/api/v1/admin/banquets/requests']!.get!.tags).toEqual(['admin']);
    expect(doc.paths['/api/v1/admin/banquets/requests']!.get!.security).toEqual([{ staff: [] }]);
    expect(doc.paths['/api/v1/public/banquets/requests']!.post!.tags).toEqual(['public']);
  });
});
