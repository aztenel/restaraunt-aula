import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SeedContext } from '../../shared/infrastructure/seed/seed.types';
import { seedBanquet } from './infrastructure/seed';
import { api, BanquetTestContext, banquetWorld, BanquetWorld, createBanquetTestApp, resetBanquet } from './testing/banquet-test-kit';

describe('Banquet: seed (integration)', () => {
  let ctx: BanquetTestContext;
  let w: BanquetWorld;

  beforeAll(async () => {
    ctx = await createBanquetTestApp();
  });
  afterAll(async () => ctx.t.close());
  beforeEach(async () => {
    await resetBanquet(ctx);
    w = await banquetWorld(ctx);
  });

  function seedContext(demo: boolean): SeedContext {
    return {
      app: ctx.t.app,
      branches: { greenline: w.branchId, 'garden-view': w.otherBranchId },
      legalEntityId: w.legalEntityId,
      ownerUserId: w.ownerId,
      demo,
      log: () => undefined,
    };
  }

  it('creates the default contract template always and one demo request idempotently', async () => {
    await seedBanquet(seedContext(false));
    await seedBanquet(seedContext(false));
    const templates = await ctx.t.http().get(api('/admin/banquets/contract-templates')).set('authorization', w.managerAuth);
    expect(templates.body).toHaveLength(1);
    expect(templates.body[0]).toMatchObject({ code: 'banquet-standard', isDefault: true });
    expect(templates.body[0].body).toContain('{{seller.name}}');
    expect((await ctx.t.http().get(api('/admin/banquets/requests')).set('authorization', w.managerAuth)).body.total).toBe(0);

    await seedBanquet(seedContext(true));
    await seedBanquet(seedContext(true));
    const requests = await ctx.t.http().get(api('/admin/banquets/requests')).set('authorization', w.managerAuth);
    expect(requests.body.total).toBe(1);
    expect(requests.body.items[0]).toMatchObject({ status: 'in_progress', branchId: w.branchId, guests: 120, quoteVersion: 1 });
    expect(requests.body.items[0].quoteTotal.amount).toBeGreaterThan(0);

    // Шаблон из сидов формирует договор.
    const contract = await ctx.t.http().post(api(`/admin/banquets/requests/${requests.body.items[0].id}/contract`)).set('authorization', w.managerAuth).send({});
    expect(contract.status).toBe(201);
  });
});
