import { ValidationError } from '../../../shared/kernel/errors';
import { normalizeTranslatable, Translatable } from '../../../shared/kernel/translatable';
import { ConsentKind } from '../public';

/**
 * Согласия гостя (закон РК о персональных данных): согласие на обработку ПД (обязательно для
 * заказа/брони/заявки с витрины) и маркетинговое (отдельно и необязательно). Каждое согласие или
 * отзыв — запись с датой, версией текста, источником и IP. Тексты версионируются.
 */
export const CONSENT_KINDS = ['personal_data', 'marketing'] as const satisfies readonly ConsentKind[];
export const CONSENT_SOURCES = ['web', 'admin', 'phone'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;

export function isConsentKind(value: unknown): value is ConsentKind {
  return typeof value === 'string' && (CONSENT_KINDS as readonly string[]).includes(value);
}

export function assertConsentKind(value: unknown): ConsentKind {
  if (!isConsentKind(value)) {
    throw new ValidationError('consent.kind_invalid', 'Consent kind must be personal_data or marketing', { kind: value });
  }
  return value;
}

export function assertConsentSource(value: unknown): ConsentSource {
  if (typeof value !== 'string' || !(CONSENT_SOURCES as readonly string[]).includes(value)) {
    throw new ValidationError('consent.source_invalid', 'Consent source must be web, admin or phone', { source: value });
  }
  return value as ConsentSource;
}

/** Версия текста: латиница, цифры, '.', '_' и '-' (например '2026-09-25' или 'v2.1'). */
export function normalizeConsentVersion(raw: string): string {
  const value = (raw ?? '').trim();
  if (!VERSION_RE.test(value)) {
    throw new ValidationError('consent.version_invalid', 'Version: 1-32 latin letters, digits, ".", "_" or "-"', { version: raw });
  }
  return value;
}

/**
 * Текст согласия публикуется на обоих государственных/официальных языках (kk и ru):
 * гость должен видеть текст, с которым соглашается, на своём языке. en — опционально.
 */
export function assertConsentText(text: Translatable): Translatable {
  const normalized = normalizeTranslatable(text as Record<string, unknown>);
  const missing = (['kk', 'ru'] as const).filter((l) => !normalized[l]);
  if (missing.length > 0) {
    throw new ValidationError('consent_text.translation_required', 'Consent text must be provided in kk and ru', { missing });
  }
  return normalized;
}

export interface ConsentFlags {
  personalDataConsent: boolean;
  personalDataConsentVersion: string | null;
  personalDataConsentAt: Date | null;
  marketingConsent: boolean;
  marketingConsentVersion: string | null;
  marketingConsentAt: Date | null;
}

/** Текущие флаги карточки после нового согласия/отзыва (история хранится отдельно). */
export function applyConsent(flags: ConsentFlags, input: { kind: ConsentKind; granted: boolean; version: string; at: Date }): ConsentFlags {
  if (input.kind === 'personal_data') {
    return { ...flags, personalDataConsent: input.granted, personalDataConsentVersion: input.version, personalDataConsentAt: input.at };
  }
  return { ...flags, marketingConsent: input.granted, marketingConsentVersion: input.version, marketingConsentAt: input.at };
}

export interface ConsentTextVersion {
  version: string;
  publishedAt: Date;
}

/** Действующая версия: последняя опубликованная к моменту now. */
export function currentVersion<T extends ConsentTextVersion>(versions: readonly T[], now: Date): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.publishedAt.getTime() > now.getTime()) continue;
    if (!best || v.publishedAt.getTime() >= best.publishedAt.getTime()) best = v;
  }
  return best;
}
