import { describe, expect, it } from 'vitest';
import {
  consentState,
  currentText,
  suggestVersion,
  toPublishConsentBody,
  toRecordConsentBody,
  validatePublishConsent,
  validateStaffConsent,
} from './consent-form';
import type { ConsentText, Customer } from './types';

function text(kind: ConsentText['kind'], version: string, isCurrent: boolean): ConsentText {
  return { id: `${kind}-${version}`, kind, version, text: { kk: 'Келісемін', ru: 'Согласен' }, publishedAt: '2026-09-01T00:00:00.000Z', isCurrent };
}

const texts: ConsentText[] = [text('personal_data', '2026-09-25', true), text('personal_data', '2026-01-10', false), text('marketing', 'v1', true)];

describe('согласие, зафиксированное сотрудником', () => {
  it('обязательны вид, действие и источник; версия по умолчанию — действующая', () => {
    expect(validateStaffConsent({ kind: 'personal_data', granted: true, source: 'phone' }, texts)).toEqual({});
    expect(validateStaffConsent({}, texts)).toEqual({ kind: 'kind_required', granted: 'granted_required', source: 'source_required' });
  });

  it('отзыв согласия — такое же действие с granted=false', () => {
    expect(validateStaffConsent({ kind: 'marketing', granted: false, source: 'admin' }, texts)).toEqual({});
    expect(toRecordConsentBody({ kind: 'marketing', granted: false, source: 'admin' })).toEqual({ kind: 'marketing', granted: false, source: 'admin' });
  });

  it('версия должна быть опубликована для этого вида согласия', () => {
    expect(validateStaffConsent({ kind: 'personal_data', granted: true, source: 'admin', textVersion: '2026-01-10' }, texts)).toEqual({});
    expect(validateStaffConsent({ kind: 'personal_data', granted: true, source: 'admin', textVersion: 'v1' }, texts)).toEqual({
      textVersion: 'version_unknown',
    });
  });

  it('без опубликованного текста согласие зафиксировать нельзя', () => {
    expect(validateStaffConsent({ kind: 'marketing', granted: true, source: 'admin' }, texts.filter((t) => t.kind !== 'marketing'))).toEqual({
      textVersion: 'no_current_text',
    });
  });

  it('тело запроса: версия — только если выбрана явно', () => {
    expect(toRecordConsentBody({ kind: 'personal_data', granted: true, source: 'phone', textVersion: ' 2026-01-10 ' })).toEqual({
      kind: 'personal_data',
      granted: true,
      source: 'phone',
      textVersion: '2026-01-10',
    });
    expect(() => toRecordConsentBody({ kind: 'personal_data', source: 'phone' })).toThrow();
  });

  it('текущее состояние согласия и действующая версия', () => {
    const customer = {
      personalDataConsent: true,
      personalDataConsentVersion: '2026-09-25',
      personalDataConsentAt: '2026-09-25T10:00:00.000Z',
      marketingConsent: false,
      marketingConsentVersion: null,
      marketingConsentAt: null,
    } as Customer;
    expect(consentState(customer, 'personal_data')).toEqual({ granted: true, version: '2026-09-25', at: '2026-09-25T10:00:00.000Z' });
    expect(consentState(customer, 'marketing')).toEqual({ granted: false, version: null, at: null });
    expect(currentText('personal_data', texts)?.version).toBe('2026-09-25');
  });
});

describe('публикация новой версии текста согласия', () => {
  const valid = { kind: 'personal_data' as const, version: '2026-10-01', text: { kk: 'Мәтін', ru: 'Текст' } };

  it('версия: латиница, цифры, «.», «_», «-»; новая для этого вида', () => {
    expect(validatePublishConsent(valid, texts)).toEqual({});
    expect(validatePublishConsent({ ...valid, version: 'версия 1' }, texts)).toEqual({ version: 'version_format' });
    expect(validatePublishConsent({ ...valid, version: '2026-09-25' }, texts)).toEqual({ version: 'version_exists' });
    // та же версия у другого вида согласия допустима
    expect(validatePublishConsent({ ...valid, kind: 'marketing', version: '2026-09-25' }, texts)).toEqual({});
  });

  it('текст обязателен на казахском и русском, английский — по желанию', () => {
    expect(validatePublishConsent({ ...valid, text: { ru: 'Текст' } }, texts)).toEqual({ text: 'text_kk_required' });
    expect(validatePublishConsent({ ...valid, text: { kk: 'Мәтін' } }, texts)).toEqual({ text: 'text_ru_required' });
    expect(toPublishConsentBody({ ...valid, text: { kk: ' Мәтін ', ru: 'Текст', en: '  ' } })).toEqual({
      kind: 'personal_data',
      version: '2026-10-01',
      text: { kk: 'Мәтін', ru: 'Текст' },
    });
  });

  it('предлагаемая версия — дата, при совпадении с суффиксом', () => {
    expect(suggestVersion('marketing', '2026-09-25', texts)).toBe('2026-09-25');
    expect(suggestVersion('personal_data', '2026-09-25', texts)).toBe('2026-09-25.2');
  });
});
