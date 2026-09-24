import { timingSafeEqual } from 'node:crypto';
import { TooManyRequestsError, ValidationError } from '../../../shared/kernel/errors';

/**
 * Подтверждение телефона SMS-кодом: лимиты отправки на номер, срок жизни кода, число попыток,
 * подписанный токен подтверждения. Чистые функции; подпись (HMAC) передаётся снаружи.
 */
export const OTP_POLICY = {
  codeLength: 4,
  /** Код действует 5 минут. */
  codeTtlMs: 5 * 60_000,
  /** Повторная отправка на тот же номер — не чаще раза в 60 секунд. */
  resendIntervalMs: 60_000,
  /** Не больше 5 кодов на номер за час. */
  maxSendsPerWindow: 5,
  sendWindowMs: 60 * 60_000,
  /** Не больше 5 попыток ввода кода. */
  maxAttempts: 5,
  /** Токен подтверждения действует 30 минут. */
  tokenTtlMs: 30 * 60_000,
} as const;

function secondsCeil(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

/**
 * Можно ли отправить новый код на номер. sentAt — моменты отправки за последний час (любой порядок).
 * TooManyRequestsError с retryAfterSeconds, если нельзя.
 */
export function assertCanSendCode(sentAt: readonly Date[], now: Date): void {
  const windowStart = now.getTime() - OTP_POLICY.sendWindowMs;
  const inWindow = sentAt.map((d) => d.getTime()).filter((t) => t > windowStart && t <= now.getTime());
  if (inWindow.length === 0) return;
  const last = Math.max(...inWindow);
  const sinceLast = now.getTime() - last;
  if (sinceLast < OTP_POLICY.resendIntervalMs) {
    const retryAfterSeconds = secondsCeil(OTP_POLICY.resendIntervalMs - sinceLast);
    throw new TooManyRequestsError('phone.resend_too_soon', 'Code was sent recently, try again later', { retryAfterSeconds });
  }
  if (inWindow.length >= OTP_POLICY.maxSendsPerWindow) {
    const oldest = [...inWindow].sort((a, b) => a - b)[inWindow.length - OTP_POLICY.maxSendsPerWindow]!;
    const retryAfterSeconds = secondsCeil(oldest + OTP_POLICY.sendWindowMs - now.getTime());
    throw new TooManyRequestsError('phone.too_many_codes', 'Too many codes for this phone, try again later', { retryAfterSeconds });
  }
}

export function isValidCodeFormat(code: string): boolean {
  return new RegExp(`^\\d{${OTP_POLICY.codeLength}}$`).test(code);
}

export interface VerificationState {
  expiresAt: Date;
  attempts: number;
  verifiedAt: Date | null;
  supersededAt: Date | null;
}

export type VerificationDecision =
  | { kind: 'verified'; verifiedAt: Date; firstTime: boolean }
  | { kind: 'invalid'; attempts: number; attemptsLeft: number }
  | { kind: 'expired'; reason: 'expired' | 'superseded' }
  | { kind: 'locked' };

/**
 * Решение по попытке ввода кода. codeMatches вычисляется снаружи (сравнение HMAC).
 * Повторный ввод верного кода уже подтверждённой проверки возвращает то же подтверждение (идемпотентно).
 */
export function decideVerification(state: VerificationState, codeMatches: boolean, now: Date): VerificationDecision {
  if (state.supersededAt && !state.verifiedAt) return { kind: 'expired', reason: 'superseded' };
  if (now.getTime() >= state.expiresAt.getTime()) return { kind: 'expired', reason: 'expired' };
  if (state.attempts >= OTP_POLICY.maxAttempts) return { kind: 'locked' };
  if (!codeMatches) {
    const attempts = state.attempts + 1;
    return { kind: 'invalid', attempts, attemptsLeft: Math.max(0, OTP_POLICY.maxAttempts - attempts) };
  }
  return state.verifiedAt
    ? { kind: 'verified', verifiedAt: state.verifiedAt, firstTime: false }
    : { kind: 'verified', verifiedAt: now, firstTime: true };
}

/** Ошибка по решению (для всех исходов, кроме verified). */
export function verificationError(decision: Exclude<VerificationDecision, { kind: 'verified' }>): Error {
  switch (decision.kind) {
    case 'invalid':
      return new ValidationError('phone.code_invalid', 'Invalid code', { attemptsLeft: decision.attemptsLeft });
    case 'expired':
      return new ValidationError('phone.code_expired', 'Code has expired, request a new one', { reason: decision.reason });
    case 'locked':
      return new TooManyRequestsError('phone.too_many_attempts', 'Too many attempts, request a new code');
  }
}

// ---------------------------------------------------------------- токен подтверждения

export interface PhoneTokenPayload {
  /** Нормализованный телефон. */
  phone: string;
  /** Срок действия, мс с эпохи. */
  expiresAt: number;
  verificationId: string;
}

export type Signer = (data: string) => string;

const TOKEN_VERSION = 'pv1';

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Токен: pv1.<base64url(json)>.<hmac>. Без состояния: проверяется подписью и сроком. */
export function encodePhoneToken(payload: PhoneTokenPayload, sign: Signer): string {
  const body = b64url(JSON.stringify({ p: payload.phone, e: payload.expiresAt, v: payload.verificationId }));
  return `${TOKEN_VERSION}.${body}.${sign(`${TOKEN_VERSION}.${body}`)}`;
}

function notVerified(reason: 'missing' | 'invalid' | 'expired' | 'phone_mismatch'): ValidationError {
  return new ValidationError('phone.not_verified', 'Phone is not verified', { reason });
}

/** Разобрать и проверить токен. ValidationError 'phone.not_verified' с причиной. */
export function decodePhoneToken(token: string | null | undefined, sign: Signer, now: Date): PhoneTokenPayload {
  if (!token) throw notVerified('missing');
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !parts[1] || !parts[2]) throw notVerified('invalid');
  const expected = sign(`${parts[0]}.${parts[1]}`);
  if (!constantTimeEqual(expected, parts[2])) throw notVerified('invalid');
  let raw: { p?: unknown; e?: unknown; v?: unknown };
  try {
    raw = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as typeof raw;
  } catch {
    throw notVerified('invalid');
  }
  if (typeof raw.p !== 'string' || typeof raw.e !== 'number' || typeof raw.v !== 'string') throw notVerified('invalid');
  if (now.getTime() >= raw.e) throw notVerified('expired');
  return { phone: raw.p, expiresAt: raw.e, verificationId: raw.v };
}

/** Токен подтверждает именно этот (нормализованный) телефон. */
export function assertTokenForPhone(token: string | null | undefined, phone: string, sign: Signer, now: Date): PhoneTokenPayload {
  const payload = decodePhoneToken(token, sign, now);
  if (payload.phone !== phone) throw notVerified('phone_mismatch');
  return payload;
}
