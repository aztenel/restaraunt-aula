import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IntegrationSettings } from '../../shared/infrastructure/settings/integration-settings';
import { newId } from '../../shared/kernel/ids';
import { ROUTING_SETTINGS_KEY } from './application/payment-gateway.registry';
import { SANDBOX_SETTINGS_KEY } from './infrastructure/adapters/sandbox/sandbox.gateway';
import { CertificateProductRepository } from './infrastructure/certificate-product.repository';
import { seedPayments } from './infrastructure/seed';
import { createPaymentsTestApp, PaymentsTestContext, resetPayments, setIntegration } from './testing/payments-test-kit';

describe('Payments seed (integration)', () => {
  let ctx: PaymentsTestContext;

  beforeAll(async () => {
    ctx = await createPaymentsTestApp();
  });
  afterAll(async () => ctx.t.close());
  beforeEach(async () => resetPayments(ctx));

  const seedContext = (demo: boolean) => ({
    app: ctx.t.app,
    branches: { greenline: newId(), 'garden-view': newId() },
    legalEntityId: newId(),
    ownerUserId: newId(),
    demo,
    log: () => undefined,
  });

  it('enables the sandbox provider and demo products idempotently', async () => {
    await seedPayments(seedContext(true));
    await seedPayments(seedContext(true));
    const settings = ctx.t.get(IntegrationSettings);
    settings.invalidate();
    expect(await settings.getRaw(SANDBOX_SETTINGS_KEY)).toMatchObject({ enabled: true });
    expect((await settings.getRaw(ROUTING_SETTINGS_KEY))?.config).toEqual({ defaultProvider: 'sandbox', branchOverrides: {} });
    const products = await ctx.t.get(CertificateProductRepository).list({ activeOnly: true });
    expect(products.map((p) => [p.slug, p.kind, p.nominal.amount])).toEqual([
      ['nominal-5000', 'amount', 500_000],
      ['nominal-10000', 'amount', 1_000_000],
      ['nominal-20000', 'amount', 2_000_000],
      ['nominal-50000', 'amount', 5_000_000],
      ['set-dinner-for-two', 'set', 2_500_000],
    ]);
    expect(products[4]!.name.ru).toBe('Ужин на двоих');
  });

  it('does not override configured settings and skips demo data without the demo flag', async () => {
    await setIntegration(ctx, ROUTING_SETTINGS_KEY, { defaultProvider: 'halyk', branchOverrides: {} });
    await seedPayments(seedContext(false));
    const settings = ctx.t.get(IntegrationSettings);
    settings.invalidate();
    expect((await settings.getRaw(ROUTING_SETTINGS_KEY))?.config).toMatchObject({ defaultProvider: 'halyk' });
    expect(await ctx.t.get(CertificateProductRepository).list({ activeOnly: false })).toEqual([]);
  });
});
