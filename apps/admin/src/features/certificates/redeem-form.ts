/**
 * Погашение сертификата на точке: ввод кода, проверка результата сервера и сборка запроса списания.
 * Правила погашения (зеркало GiftCertificate.debit на сервере, только для подсказок кассиру):
 *  - «на сумму» — частичное списание: сумма > 0 и не больше остатка;
 *  - «на набор» — только целиком: сумма не передаётся, сервер спишет весь остаток.
 * Окончательно всё проверяет сервер (certificate.insufficient_balance, set_full_redemption_only…).
 */
import type { CertificateBalance, CertificateKind, RedeemBody } from './types';

/** Алфавит кода без похожих символов (0/O, 1/I/L) — как UNAMBIGUOUS_ALPHABET на сервере. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 12;
export const REDEEM_COMMENT_MAX = 500;

/** Ввод кассира → «XXXX-XXXX-XXXX»: верхний регистр, пробелы и дефисы не важны, максимум 12 символов. */
export function formatCodeInput(raw: string): string {
  const compact = compactCode(raw).slice(0, CODE_LENGTH);
  return compact.match(/.{1,4}/g)?.join('-') ?? '';
}

/** Только буквы и цифры в верхнем регистре (без дефисов и пробелов). */
export function compactCode(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** В коде есть символы, которых не бывает в сертификатах (0, 1, O, I, L) — вероятно, опечатка. */
export function hasAmbiguousChars(raw: string): boolean {
  return [...compactCode(raw)].some((ch) => !CODE_ALPHABET.includes(ch));
}

/** Код полностью введён и может быть проверен. */
export function isCodeComplete(raw: string): boolean {
  const compact = compactCode(raw);
  return compact.length === CODE_LENGTH && !hasAmbiguousChars(compact);
}

/** Как погашается сертификат этого вида: на сумму — частично, набор — только целиком. */
export function redeemMode(kind: CertificateKind): 'partial' | 'full' {
  return kind === 'set' ? 'full' : 'partial';
}

export type RedeemBlocker = 'blocked' | 'redeemed' | 'expired' | 'empty';

/** Почему погасить нельзя (по ответу проверки) — для понятного сообщения кассиру; null — можно. */
export function redeemBlocker(certificate: Pick<CertificateBalance, 'status' | 'balance'>): RedeemBlocker | null {
  if (certificate.status !== 'active') return certificate.status;
  if (certificate.balance.amount <= 0) return 'empty';
  return null;
}

export interface RedeemFormValues {
  /** Сумма списания, тиыны (только для сертификата на сумму). */
  amount?: number | null;
  /** Комментарий: номер чека POS. */
  comment?: string | null;
}

export type RedeemIssue = 'amount_required' | 'amount_positive' | 'amount_exceeds_balance' | 'comment_too_long';
export type RedeemErrors = Partial<Record<'amount' | 'comment', RedeemIssue>>;

export function validateRedeem(values: RedeemFormValues, certificate: Pick<CertificateBalance, 'kind' | 'balance'>): RedeemErrors {
  const errors: RedeemErrors = {};
  if (redeemMode(certificate.kind) === 'partial') {
    const amount = values.amount;
    if (amount === null || amount === undefined) errors.amount = 'amount_required';
    else if (amount <= 0) errors.amount = 'amount_positive';
    else if (amount > certificate.balance.amount) errors.amount = 'amount_exceeds_balance';
  }
  if ((values.comment?.trim().length ?? 0) > REDEEM_COMMENT_MAX) errors.comment = 'comment_too_long';
  return errors;
}

/**
 * Тело POST /admin/certificates/redeem. Набор — без суммы (погашается целиком), на сумму — с суммой.
 * Код передаётся тот, что проверяли (сервер снова найдёт сертификат по коду под блокировкой).
 */
export function toRedeemBody(
  code: string,
  values: RedeemFormValues,
  certificate: Pick<CertificateBalance, 'kind'>,
  branchId: string,
): RedeemBody {
  const comment = values.comment?.trim() || undefined;
  const body: RedeemBody = { code: formatCodeInput(code), branchId, ...(comment ? { comment } : {}) };
  if (redeemMode(certificate.kind) === 'partial') {
    if (typeof values.amount !== 'number') throw new Error('amount is required for an amount certificate');
    body.amount = { amount: values.amount, currency: 'KZT' };
  }
  return body;
}

/** Сумма, которая будет списана (для текста подтверждения): набор — весь остаток, иначе введённая. */
export function amountToDebit(values: RedeemFormValues, certificate: Pick<CertificateBalance, 'kind' | 'balance'>): number | null {
  if (redeemMode(certificate.kind) === 'full') return certificate.balance.amount;
  return typeof values.amount === 'number' ? values.amount : null;
}
