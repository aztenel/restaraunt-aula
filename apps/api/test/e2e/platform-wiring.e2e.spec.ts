import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HandlerRegistry } from '../../src/shared/infrastructure/events/handler-registry';
import { createE2eApp, E2eContext, pendingOutbox } from './support/e2e-app';

describe('E2E: full application wiring', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
    await ctx.reset();
  });
  afterAll(async () => ctx?.close());

  it('boots all real modules and seeds demo data', async () => {
    const registry = ctx.t.get(HandlerRegistry);
    expect(registry.eventTypes().length).toBeGreaterThan(10);
    expect(ctx.seed.branches.greenline).toBeTruthy();
    expect(await pendingOutbox(ctx)).toEqual([]);
  });
});
