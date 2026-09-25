import { expect } from 'vitest';
import { E2eContext, idem, POINT_NEAR_GL } from './e2e-app';

export const GUEST_PHONE = '+77011112233';

export interface MenuDish {
  id: string;
  slug: string;
  name: string;
  price: { amount: number; currency: string };
  available: boolean;
}

/** Меню филиала на витрине: блюда по slug. */
export async function storefrontMenu(ctx: E2eContext, branchSlug: string): Promise<Map<string, MenuDish>> {
  const res = await ctx.api().get(`/api/v1/public/catalog/branches/${branchSlug}/menu`).query({ locale: 'ru' }).expect(200);
  const map = new Map<string, MenuDish>();
  for (const c of res.body.categories as Array<{ dishes: MenuDish[] }>) for (const d of c.dishes) map.set(d.slug, d);
  return map;
}

/** Опция модификатора по названию из карточки блюда. */
export async function modifierOption(ctx: E2eContext, branchSlug: string, dishSlug: string, optionName: string): Promise<{ id: string; price: { amount: number } }> {
  const res = await ctx.api().get(`/api/v1/public/catalog/branches/${branchSlug}/dishes/${dishSlug}`).query({ locale: 'ru' }).expect(200);
  for (const g of res.body.modifierGroups as Array<{ options: Array<{ id: string; name: string; price: { amount: number } }> }>) {
    const o = g.options.find((x) => x.name === optionName);
    if (o) return o;
  }
  throw new Error(`Option ${optionName} not found for ${dishSlug}`);
}

export interface CheckoutOptions {
  branchId: string;
  type: 'delivery' | 'pickup';
  items: Array<{ dishId: string; quantity: number; modifierOptionIds?: string[] }>;
  paymentMethod: 'online' | 'on_receipt';
  phone?: string;
  name?: string;
  email?: string | null;
  promoCode?: string | null;
  certificateCode?: string | null;
  phoneVerificationToken?: string | null;
  point?: { lat: number; lng: number };
  idempotencyKey?: string;
}

export function checkoutBody(o: CheckoutOptions) {
  return {
    branchId: o.branchId,
    type: o.type,
    items: o.items.map((i) => ({ dishId: i.dishId, quantity: i.quantity, modifierOptionIds: i.modifierOptionIds ?? [] })),
    delivery:
      o.type === 'delivery'
        ? { point: o.point ?? POINT_NEAR_GL, addressText: 'Астана, ул. Е-899, 5, кв. 12', apartment: '12', entrance: '2', floor: '4', intercom: '12К' }
        : null,
    contactless: false,
    scheduledFor: null,
    customer: { name: o.name ?? 'Айгерим', phone: o.phone ?? GUEST_PHONE, email: o.email ?? null },
    comment: 'Без лука, пожалуйста',
    promoCode: o.promoCode ?? null,
    certificateCode: o.certificateCode ?? null,
    paymentMethod: o.paymentMethod,
    phoneVerificationToken: o.phoneVerificationToken ?? null,
    consent: { personalData: true, marketing: true },
    locale: 'ru',
    analyticsSessionId: null,
    idempotencyKey: o.idempotencyKey ?? idem('order'),
  };
}

export async function placeOrder(ctx: E2eContext, o: CheckoutOptions): Promise<{ orderId: string; number: string; publicToken: string; body: any }> {
  const res = await ctx.api().post('/api/v1/public/orders').send(checkoutBody(o));
  if (res.status !== 201) throw new Error(`checkout failed ${res.status}: ${JSON.stringify(res.body)}`);
  return { orderId: res.body.orderId, number: res.body.number, publicToken: res.body.publicToken, body: res.body };
}

export async function tracking(ctx: E2eContext, publicToken: string): Promise<any> {
  return (await ctx.api().get(`/api/v1/public/orders/${publicToken}`).query({ locale: 'ru' }).expect(200)).body;
}

export async function adminOrder(ctx: E2eContext, orderId: string, auth: string): Promise<any> {
  return (await ctx.api().get(`/api/v1/admin/orders/${orderId}`).set('Authorization', auth).expect(200)).body;
}

/** Смена статуса оператором с проверкой, что переход был среди доступных (allowedTransitions). */
export async function advanceOrder(ctx: E2eContext, orderId: string, auth: string, to: string): Promise<any> {
  const before = await adminOrder(ctx, orderId, auth);
  expect(before.allowedTransitions).toContain(to);
  const res = await ctx.api().post(`/api/v1/admin/orders/${orderId}/transition`).set('Authorization', auth).send({ to });
  if (res.status !== 200) throw new Error(`transition to ${to} failed ${res.status}: ${JSON.stringify(res.body)}`);
  expect(res.body.status).toBe(to);
  return res.body;
}

export async function report(ctx: E2eContext, name: string, query: Record<string, unknown>): Promise<any> {
  const res = await ctx.api().get(`/api/v1/admin/reports/${name}`).query(query).set('Authorization', await ctx.owner());
  if (res.status !== 200) throw new Error(`report ${name} failed ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function customerByPhone(ctx: E2eContext, phone: string): Promise<any> {
  const list = await ctx.api().get('/api/v1/admin/customers').query({ q: phone.replace(/\D/g, '') }).set('Authorization', await ctx.owner()).expect(200);
  const found = (list.body.items as Array<{ id: string; phone: string }>).find((c) => c.phone === phone);
  if (!found) throw new Error(`customer ${phone} not found: ${JSON.stringify(list.body.items)}`);
  const detail = await ctx.api().get(`/api/v1/admin/customers/${found.id}`).set('Authorization', await ctx.owner()).expect(200);
  return detail.body;
}

export async function paymentsOf(ctx: E2eContext, referenceId: string): Promise<any[]> {
  const res = await ctx.api().get('/api/v1/admin/payments').query({ referenceId }).set('Authorization', await ctx.owner()).expect(200);
  return res.body.items;
}
