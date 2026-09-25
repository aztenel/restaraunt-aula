/**
 * Действия над выпущенным сертификатом (certificates.manage): блокировка, продление срока, переотправка.
 * Проверка ввода до отправки — зеркало BlockCertificateDto / ExtendCertificateDto / ResendCertificateDto;
 * окончательно правила проверяет сервер (certificate.extend_invalid, not_blocked…).
 */
import type { CertificateStatus, ResendBody } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ActionReasonIssue = 'reason_required' | 'reason_too_short' | 'reason_too_long';

/** Причина обязательна (блокировка, продление): 2–500 символов. */
export function requiredReasonIssue(reason: string | null | undefined): ActionReasonIssue | undefined {
  const text = reason?.trim() ?? '';
  if (!text) return 'reason_required';
  if (text.length < 2) return 'reason_too_short';
  if (text.length > 500) return 'reason_too_long';
  return undefined;
}

/** Необязательная причина (разблокировка): до 500 символов. */
export function optionalReasonIssue(reason: string | null | undefined): ActionReasonIssue | undefined {
  return (reason?.trim().length ?? 0) > 500 ? 'reason_too_long' : undefined;
}

export type ExtendIssue = 'date_required' | 'date_not_later';

/**
 * Новый последний день действия (YYYY-MM-DD) — позже текущего и не раньше сегодняшнего дня.
 * Даты сравниваются как строки ISO (лексикографически = хронологически).
 */
export function extendIssue(newValidUntil: string | null, currentValidUntil: string, today: string): ExtendIssue | undefined {
  if (!newValidUntil) return 'date_required';
  if (newValidUntil <= currentValidUntil || newValidUntil < today) return 'date_not_later';
  return undefined;
}

/** Какие действия показывать по статусу (сервер всё равно проверит переход). */
export function availableActions(status: CertificateStatus): { block: boolean; unblock: boolean; extend: boolean } {
  return {
    block: status === 'active' || status === 'expired',
    unblock: status === 'blocked',
    extend: status !== 'redeemed',
  };
}

export interface ResendFormValues {
  /** undefined — как при покупке. */
  channel?: 'email' | 'whatsapp';
  email?: string;
  phone?: string;
}

export type ResendIssue = 'email_invalid' | 'channel_required';

export function validateResend(values: ResendFormValues, purchaseChannel: 'email' | 'whatsapp' | 'none'): Partial<Record<'channel' | 'email', ResendIssue>> {
  const errors: Partial<Record<'channel' | 'email', ResendIssue>> = {};
  if (!values.channel && purchaseChannel === 'none') errors.channel = 'channel_required';
  const email = values.email?.trim();
  if (email && !EMAIL_RE.test(email)) errors.email = 'email_invalid';
  return errors;
}

export function toResendBody(values: ResendFormValues): ResendBody {
  const body: ResendBody = {};
  if (values.channel) body.channel = values.channel;
  if (values.email?.trim()) body.email = values.email.trim();
  if (values.phone?.trim()) body.phone = values.phone.trim();
  return body;
}
