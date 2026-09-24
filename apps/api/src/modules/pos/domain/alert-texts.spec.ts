import { describe, expect, it } from 'vitest';
import { cancelledAfterSentAlert, exportFailureAlert, stopListSyncAlert } from './alert-texts';

describe('POS alert texts', () => {
  it('missing mapping lists dishes and tells the kitchen to work from the admin screen', () => {
    const alert = exportFailureAlert({
      orderNumber: 'GL-2026-000001',
      reason: 'missing_mapping',
      error: 'x',
      attempts: 1,
      missing: [{ dishId: 'd', dishName: 'Плов', dishMissing: true, options: [] }],
      link: 'https://admin/orders/1',
    });
    expect(alert.title).toBe('Заказ GL-2026-000001 не передан в POS');
    expect(alert.details).toContain('Плов');
    expect(alert.details).toContain('готовьте по экрану заказа');
    expect(alert.details).toContain('https://admin/orders/1');
  });

  it('every failure reason has a text', () => {
    for (const reason of ['not_configured', 'rejected', 'retries_exhausted', 'order_unavailable'] as const) {
      const alert = exportFailureAlert({ orderNumber: 'N', reason, error: 'boom', attempts: 6 });
      expect(alert.details).toContain('boom');
    }
    expect(exportFailureAlert({ orderNumber: 'N', reason: 'retries_exhausted', error: 'e', attempts: 6 }).details).toContain('6');
  });

  it('cancel and sync texts', () => {
    expect(cancelledAfterSentAlert({ orderNumber: 'N', posOrderId: 'P-1' }).details).toContain('P-1');
    expect(stopListSyncAlert({ providerTitle: 'pos_a', failures: 3, error: 'HTTP 503' }).details).toContain('HTTP 503');
  });
});
