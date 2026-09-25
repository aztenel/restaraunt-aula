/**
 * Согласия гостя (закон РК о персональных данных):
 *  - сотрудник фиксирует согласие/отзыв, полученные лично или по телефону, с версией текста
 *    (по умолчанию — действующая); каждое действие — запись с датой, версией и источником;
 *  - тексты согласий версионируются: новая версия публикуется на kk и ru (en — опционально) и сразу
 *    становится действующей, опубликованную версию изменить нельзя.
 * Проверки — зеркало RecordStaffConsent / PublishConsentText на сервере.
 */
import type { Translatable } from '@aula/api-client';
import type { ConsentKind, ConsentText, Customer, PublishConsentTextBody, RecordConsentBody, StaffConsentSource } from './types';

export const CONSENT_VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;

export interface StaffConsentValues {
  kind?: ConsentKind;
  /** true — согласие, false — отзыв. */
  granted?: boolean;
  source?: StaffConsentSource;
  /** Версия текста; пусто — действующая. */
  textVersion?: string | null;
}

export type StaffConsentIssue = 'kind_required' | 'granted_required' | 'source_required' | 'version_unknown' | 'no_current_text';

export type StaffConsentErrors = Partial<Record<'kind' | 'granted' | 'source' | 'textVersion', StaffConsentIssue>>;

/** Опубликованные версии текста данного вида (новые сверху, как отдаёт сервер). */
export function versionsOf(kind: ConsentKind | undefined, texts: readonly ConsentText[]): ConsentText[] {
  return kind ? texts.filter((text) => text.kind === kind) : [];
}

/** Действующая версия текста (isCurrent от сервера). */
export function currentText(kind: ConsentKind | undefined, texts: readonly ConsentText[]): ConsentText | null {
  return versionsOf(kind, texts).find((text) => text.isCurrent) ?? null;
}

export function validateStaffConsent(values: StaffConsentValues, texts: readonly ConsentText[]): StaffConsentErrors {
  const errors: StaffConsentErrors = {};
  if (!values.kind) errors.kind = 'kind_required';
  if (typeof values.granted !== 'boolean') errors.granted = 'granted_required';
  if (values.source !== 'admin' && values.source !== 'phone') errors.source = 'source_required';
  if (values.kind) {
    const version = values.textVersion?.trim();
    if (version) {
      if (!versionsOf(values.kind, texts).some((text) => text.version === version)) errors.textVersion = 'version_unknown';
    } else if (!currentText(values.kind, texts)) {
      errors.textVersion = 'no_current_text';
    }
  }
  return errors;
}

/** Тело POST /admin/customers/{id}/consents. Версия не передаётся, если выбрана действующая по умолчанию. */
export function toRecordConsentBody(values: StaffConsentValues): RecordConsentBody {
  if (!values.kind || typeof values.granted !== 'boolean' || !values.source) throw new Error('consent form is incomplete');
  const body: RecordConsentBody = { kind: values.kind, granted: values.granted, source: values.source };
  const version = values.textVersion?.trim();
  if (version) body.textVersion = version;
  return body;
}

/** Текущее состояние согласия в карточке гостя. */
export function consentState(customer: Customer, kind: ConsentKind): { granted: boolean; version: string | null; at: string | null } {
  return kind === 'personal_data'
    ? { granted: customer.personalDataConsent, version: customer.personalDataConsentVersion ?? null, at: customer.personalDataConsentAt ?? null }
    : { granted: customer.marketingConsent, version: customer.marketingConsentVersion ?? null, at: customer.marketingConsentAt ?? null };
}

export interface PublishConsentValues {
  kind?: ConsentKind;
  version: string;
  text: Translatable;
}

export type PublishConsentIssue = 'kind_required' | 'version_format' | 'version_exists' | 'text_kk_required' | 'text_ru_required';

export type PublishConsentErrors = Partial<Record<'kind' | 'version' | 'text', PublishConsentIssue>>;

export function validatePublishConsent(values: PublishConsentValues, existing: readonly ConsentText[]): PublishConsentErrors {
  const errors: PublishConsentErrors = {};
  if (!values.kind) errors.kind = 'kind_required';
  const version = values.version.trim();
  if (!CONSENT_VERSION_RE.test(version)) errors.version = 'version_format';
  else if (values.kind && versionsOf(values.kind, existing).some((text) => text.version === version)) errors.version = 'version_exists';
  // Текст обязателен на обоих языках: гость видит текст, с которым соглашается, на своём языке.
  if (!values.text.kk?.trim()) errors.text = 'text_kk_required';
  else if (!values.text.ru?.trim()) errors.text = 'text_ru_required';
  return errors;
}

export function toPublishConsentBody(values: PublishConsentValues): PublishConsentTextBody {
  if (!values.kind) throw new Error('kind is required');
  const text: PublishConsentTextBody['text'] = { kk: values.text.kk?.trim(), ru: values.text.ru?.trim() };
  const en = values.text.en?.trim();
  if (en) text.en = en;
  return { kind: values.kind, version: values.version.trim(), text };
}

/** Предлагаемая версия: дата публикации (2026-09-25), при совпадении — с суффиксом (2026-09-25.2). */
export function suggestVersion(kind: ConsentKind | undefined, today: string, existing: readonly ConsentText[]): string {
  const taken = new Set(versionsOf(kind, existing).map((text) => text.version));
  if (!taken.has(today)) return today;
  let n = 2;
  while (taken.has(`${today}.${n}`)) n += 1;
  return `${today}.${n}`;
}
