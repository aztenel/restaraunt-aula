import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TooManyRequestsError, ValidationError } from '../../../shared/kernel/errors';
import {
  assertCanSendCode,
  assertTokenForPhone,
  decideVerification,
  decodePhoneToken,
  encodePhoneToken,
  isValidCodeFormat,
  OTP_POLICY,
  verificationError,
  VerificationState,
} from './otp';

const now = new Date('2026-10-01T06:00:00Z');
const at = (msAgo: number) => new Date(now.getTime() - msAgo);
const sign = (data: string) => createHmac('sha256', 'test-key').update(data).digest('hex');

function codeOf(fn: () => unknown): { code: string; details: unknown; type: string } {
  try {
    fn();
  } catch (e) {
    const err = e as ValidationError;
    return { code: err.code, details: err.details, type: err.constructor.name };
  }
  throw new Error('expected to throw');
}

describe('otp: send limits per phone', () => {
  it('allows the first code and a resend after 60 seconds', () => {
    expect(() => assertCanSendCode([], now)).not.toThrow();
    expect(() => assertCanSendCode([at(60_000)], now)).not.toThrow();
  });

  it('rejects resend sooner than 60 seconds with retryAfterSeconds', () => {
    const err = codeOf(() => assertCanSendCode([at(15_000)], now));
    expect(err.code).toBe('phone.resend_too_soon');
    expect(err.type).toBe(TooManyRequestsError.name);
    expect(err.details).toEqual({ retryAfterSeconds: 45 });
  });

  it('allows at most 5 codes per hour', () => {
    const five = [at(50 * 60_000), at(40 * 60_000), at(30 * 60_000), at(20 * 60_000), at(10 * 60_000)];
    const err = codeOf(() => assertCanSendCode(five, now));
    expect(err.code).toBe('phone.too_many_codes');
    // Самый старый из пяти выйдет из окна через 10 минут.
    expect(err.details).toEqual({ retryAfterSeconds: 600 });
    expect(() => assertCanSendCode(five.slice(1), now)).not.toThrow();
    // Отправки старше часа не считаются.
    expect(() => assertCanSendCode([at(61 * 60_000), ...five.slice(1)], now)).not.toThrow();
  });

  it('checks code format', () => {
    expect(isValidCodeFormat('0123')).toBe(true);
    expect(isValidCodeFormat('123')).toBe(false);
    expect(isValidCodeFormat('12a4')).toBe(false);
  });
});

describe('otp: verification attempts', () => {
  const fresh: VerificationState = {
    expiresAt: new Date(now.getTime() + OTP_POLICY.codeTtlMs),
    attempts: 0,
    verifiedAt: null,
    supersededAt: null,
  };

  it('verifies a correct code', () => {
    expect(decideVerification(fresh, true, now)).toEqual({ kind: 'verified', verifiedAt: now, firstTime: true });
  });

  it('counts wrong attempts and locks after 5', () => {
    expect(decideVerification(fresh, false, now)).toEqual({ kind: 'invalid', attempts: 1, attemptsLeft: 4 });
    expect(decideVerification({ ...fresh, attempts: 4 }, false, now)).toEqual({ kind: 'invalid', attempts: 5, attemptsLeft: 0 });
    expect(decideVerification({ ...fresh, attempts: 5 }, true, now)).toEqual({ kind: 'locked' });
  });

  it('rejects expired and superseded codes', () => {
    expect(decideVerification({ ...fresh, expiresAt: now }, true, now)).toEqual({ kind: 'expired', reason: 'expired' });
    expect(decideVerification({ ...fresh, supersededAt: at(1000) }, true, now)).toEqual({ kind: 'expired', reason: 'superseded' });
  });

  it('is idempotent for an already verified code', () => {
    const verifiedAt = at(30_000);
    expect(decideVerification({ ...fresh, verifiedAt }, true, now)).toEqual({ kind: 'verified', verifiedAt, firstTime: false });
  });

  it('maps decisions to errors', () => {
    expect((verificationError({ kind: 'invalid', attempts: 1, attemptsLeft: 4 }) as ValidationError).code).toBe('phone.code_invalid');
    expect((verificationError({ kind: 'expired', reason: 'expired' }) as ValidationError).code).toBe('phone.code_expired');
    const locked = verificationError({ kind: 'locked' });
    expect(locked).toBeInstanceOf(TooManyRequestsError);
    expect((locked as TooManyRequestsError).code).toBe('phone.too_many_attempts');
  });
});

describe('otp: verification token', () => {
  const payload = { phone: '+77011234567', expiresAt: now.getTime() + OTP_POLICY.tokenTtlMs, verificationId: 'v-1' };

  it('round-trips a signed token', () => {
    const token = encodePhoneToken(payload, sign);
    expect(decodePhoneToken(token, sign, now)).toEqual(payload);
    expect(assertTokenForPhone(token, '+77011234567', sign, now).verificationId).toBe('v-1');
  });

  it('rejects missing, forged, expired tokens and phone mismatch', () => {
    const token = encodePhoneToken(payload, sign);
    expect(codeOf(() => decodePhoneToken(null, sign, now)).details).toEqual({ reason: 'missing' });
    expect(codeOf(() => decodePhoneToken('garbage', sign, now)).details).toEqual({ reason: 'invalid' });
    const forged = encodePhoneToken({ ...payload, phone: '+77770000000' }, (d) => createHmac('sha256', 'other').update(d).digest('hex'));
    expect(codeOf(() => decodePhoneToken(forged, sign, now)).details).toEqual({ reason: 'invalid' });
    const [v, , sig] = token.split('.');
    const tampered = `${v}.${Buffer.from(JSON.stringify({ p: '+77770000000', e: payload.expiresAt, v: 'v-1' })).toString('base64url')}.${sig}`;
    expect(codeOf(() => decodePhoneToken(tampered, sign, now)).details).toEqual({ reason: 'invalid' });
    const expired = codeOf(() => decodePhoneToken(token, sign, new Date(payload.expiresAt)));
    expect(expired).toMatchObject({ code: 'phone.not_verified', details: { reason: 'expired' } });
    expect(codeOf(() => assertTokenForPhone(token, '+77770000000', sign, now)).details).toEqual({ reason: 'phone_mismatch' });
  });
});
