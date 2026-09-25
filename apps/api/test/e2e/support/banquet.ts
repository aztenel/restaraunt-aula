import { E2eContext, idem } from './e2e-app';

export async function vipVenues(ctx: E2eContext, date = '2026-10-10', time = '19:00'): Promise<{ vip1: string; vip2: string }> {
  const res = await ctx
    .api()
    .get('/api/v1/public/branches/greenline/reservation-availability')
    .query({ date, time, guests: 8, typeCode: 'vip_hall', locale: 'ru' })
    .expect(200);
  const byName = (name: string) => (res.body.venues as any[]).find((v) => v.name === name)?.venueId as string;
  return { vip1: byName('VIP-зал «Алтын»'), vip2: byName('VIP-зал «Күміс»') };
}

/** Заявка на банкет из админки (менеджер принял звонок). */
export async function adminBanquetRequest(
  ctx: E2eContext,
  auth: string,
  input: { eventDate: string; guests: number; branchId: string; phone?: string; name?: string },
): Promise<any> {
  const res = await ctx
    .api()
    .post('/api/v1/admin/banquets/requests')
    .set('Authorization', auth)
    .send({
      eventDate: input.eventDate,
      eventTime: '18:00',
      eventType: 'birthday',
      guests: input.guests,
      branchId: input.branchId,
      contact: { name: input.name ?? 'Асель', phone: input.phone ?? '+77013334455' },
      consent: { personalData: true },
      locale: 'ru',
    });
  if (res.status !== 201) throw new Error(`banquet request failed ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

export function holdVenue(ctx: E2eContext, auth: string, requestId: string, venueId: string, date: string, startTime = '18:00', endTime = '23:00') {
  return ctx.api().put(`/api/v1/admin/banquets/requests/${requestId}/venue`).set('Authorization', auth).send({ venueId, date, startTime, endTime });
}

export function guestBooking(ctx: E2eContext, venueId: string, date: string, time: string, guests = 8, phone = '+77019990011') {
  return ctx
    .api()
    .post('/api/v1/public/reservations')
    .send({
      branchId: ctx.seed.branches.greenline,
      venueId,
      date,
      time,
      guests,
      customer: { name: 'Гость', phone },
      consent: { personalData: true },
      locale: 'ru',
      idempotencyKey: idem('resv'),
    });
}
