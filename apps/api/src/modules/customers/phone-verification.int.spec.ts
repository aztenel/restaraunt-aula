import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Fakes } from '../../../test/fakes';
import { TestApp } from '../../../test/support/test-app';
import { createCustomersTestApp } from './testing/customers-test-kit';
import { PhoneVerification } from './public';

const API = '/api/v1/public/phone-verifications';

describe('Customers: phone verification by SMS code (integration)', () => {
  let t: TestApp;
  let fakes: Fakes;
  let service: PhoneVerification;

  beforeAll(async () => {
    ({ t, fakes } = await createCustomersTestApp());
    service = t.get(PhoneVerification);
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    fakes.notifier.clear();
    vi.restoreAllMocks();
  });

  /** Последний отправленный код (из фейка уведомлений). */
  function lastCode(): string {
    const sent = fakes.notifier.guest.filter((g) => g.template === 'otp.code');
    return (sent[sent.length - 1]!.params as { code: string }).code;
  }

  function wrong(code: string): string {
    return code === '0000' ? '1111' : '0000';
  }

  it('full flow over HTTP: SMS code -> token; code stored only as a hash', async () => {
    const notify = vi.spyOn(fakes.notifier, 'notifyGuest');
    const started = await t.http().post(API).send({ phone: '8 701 123 45 67', locale: 'kk' });
    expect(started.status).toBe(201);
    expect(started.body).toEqual({
      verificationId: expect.any(String),
      expiresAt: new Date(t.clock.now().getTime() + 5 * 60_000).toISOString(),
      resendAfterSeconds: 60,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    const call = notify.mock.calls[0]![0];
    expect(call).toMatchObject({ recipient: { phone: '+77011234567' }, template: 'otp.code', locale: 'kk', channels: ['sms'] });
    const code = (call.params as { code: string }).code;
    expect(code).toMatch(/^\d{4}$/);

    const stored = await sql<{ code_hash: string }>`select code_hash from customers.phone_verifications`.execute(t.database.rootConnection());
    expect(stored.rows[0]!.code_hash).not.toContain(code);
    expect(stored.rows[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/);

    const verified = await t.http().post(`${API}/${started.body.verificationId}/verify`).send({ code });
    expect(verified.status).toBe(200);
    expect(verified.body.phone).toBe('+77011234567');
    expect(verified.body.expiresAt).toBe(new Date(t.clock.now().getTime() + 30 * 60_000).toISOString());
    await expect(service.assertVerified('+7 (701) 123-45-67', verified.body.token)).resolves.toBeUndefined();

    // Повторный ввод верного кода — тот же токен (идемпотентно).
    const again = await t.http().post(`${API}/${started.body.verificationId}/verify`).send({ code });
    expect(again.status).toBe(200);
    expect(again.body.token).toBe(verified.body.token);
  });

  it('token confirms only its phone and expires after 30 minutes', async () => {
    const { verificationId } = await service.start('+77011234567', 'ru');
    const { token, phone } = await service.verify(verificationId, lastCode());
    expect(phone).toBe('+77011234567');
    await expect(service.assertVerified('+77019998877', token)).rejects.toMatchObject({
      code: 'phone.not_verified',
      details: { reason: 'phone_mismatch' },
    });
    await expect(service.assertVerified('+77011234567', null)).rejects.toMatchObject({ code: 'phone.not_verified', details: { reason: 'missing' } });
    await expect(service.assertVerified('+77011234567', `${token}x`)).rejects.toMatchObject({ code: 'phone.not_verified', details: { reason: 'invalid' } });
    t.clock.advance(29 * 60_000);
    await expect(service.assertVerified('+77011234567', token)).resolves.toBeUndefined();
    t.clock.advance(60_000);
    await expect(service.assertVerified('+77011234567', token)).rejects.toMatchObject({ code: 'phone.not_verified', details: { reason: 'expired' } });
  });

  it('wrong codes count attempts; after 5 the verification is locked even for the right code', async () => {
    const started = await t.http().post(API).send({ phone: '+77011234567' });
    const code = lastCode();
    for (let i = 1; i <= 5; i++) {
      const res = await t.http().post(`${API}/${started.body.verificationId}/verify`).send({ code: wrong(code) });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'phone.code_invalid', details: { attemptsLeft: 5 - i } });
    }
    const locked = await t.http().post(`${API}/${started.body.verificationId}/verify`).send({ code });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('phone.too_many_attempts');
  });

  it('code expires after 5 minutes', async () => {
    const { verificationId } = await service.start('+77011234567', 'ru');
    const code = lastCode();
    t.clock.advance(5 * 60_000);
    await expect(service.verify(verificationId, code)).rejects.toMatchObject({ code: 'phone.code_expired', details: { reason: 'expired' } });
  });

  it('resend no sooner than 60 seconds; a new code supersedes the previous one', async () => {
    const first = await t.http().post(API).send({ phone: '+77011234567' });
    const firstCode = lastCode();
    t.clock.advance(20_000);
    const tooSoon = await t.http().post(API).send({ phone: '87011234567' });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error).toMatchObject({ code: 'phone.resend_too_soon', details: { retryAfterSeconds: 40 } });
    expect(tooSoon.headers['retry-after']).toBe('40');

    t.clock.advance(40_000);
    const second = await t.http().post(API).send({ phone: '+77011234567' });
    expect(second.status).toBe(201);
    const old = await t.http().post(`${API}/${first.body.verificationId}/verify`).send({ code: firstCode });
    expect(old.status).toBe(422);
    expect(old.body.error).toMatchObject({ code: 'phone.code_expired', details: { reason: 'superseded' } });
    const fresh = await t.http().post(`${API}/${second.body.verificationId}/verify`).send({ code: lastCode() });
    expect(fresh.status).toBe(200);
  });

  it('at most 5 codes per phone per hour', async () => {
    for (let i = 0; i < 5; i++) {
      await service.start('+77011234567', 'ru');
      t.clock.advance(61_000);
    }
    await expect(service.start('+77011234567', 'ru')).rejects.toMatchObject({ code: 'phone.too_many_codes' });
    // Другой номер не затронут.
    await expect(service.start('+77019998877', 'ru')).resolves.toMatchObject({ resendAfterSeconds: 60 });
    // Через час от первой отправки снова можно.
    t.clock.advance(60 * 60_000 - 5 * 61_000 + 1_000);
    await expect(service.start('+77011234567', 'ru')).resolves.toMatchObject({ resendAfterSeconds: 60 });
  });

  it('validates input: invalid phone, unknown verification, malformed id', async () => {
    const bad = await t.http().post(API).send({ phone: '123' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('phone.invalid');
    const unknown = await t.http().post(`${API}/0192a0b4-7a1e-7c3e-9f5e-0c1d2e3f4a5b/verify`).send({ code: '1234' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('phone_verification.not_found');
    const malformed = await t.http().post(`${API}/not-a-uuid/verify`).send({ code: '1234' });
    expect(malformed.status).toBe(400);
    const extra = await t.http().post(API).send({ phone: '+77011234567', admin: true });
    expect(extra.status).toBe(400);
  });

  it('rate limits code requests per IP (policy otp)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await t.http().post(API).send({ phone: `+7701000000${i}` });
      statuses.push(res.status);
      if (res.status === 429) expect(res.body.error.code).toBe('rate_limit.exceeded');
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('purges verifications older than a day (phone is personal data)', async () => {
    await service.start('+77011234567', 'ru');
    t.clock.advance(23 * 3_600_000);
    await service.start('+77019998877', 'ru');
    t.clock.advance(2 * 3_600_000);
    await t.runSchedule('customers.purge_phone_verifications');
    const rows = await sql<{ phone: string }>`select phone from customers.phone_verifications`.execute(t.database.rootConnection());
    expect(rows.rows.map((r) => r.phone)).toEqual(['+77019998877']);
  });
});
