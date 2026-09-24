import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import {
  applyConsent,
  assertConsentKind,
  assertConsentSource,
  assertConsentText,
  ConsentFlags,
  currentVersion,
  normalizeConsentVersion,
} from './consent';

const NO_CONSENT: ConsentFlags = {
  personalDataConsent: false,
  personalDataConsentVersion: null,
  personalDataConsentAt: null,
  marketingConsent: false,
  marketingConsentVersion: null,
  marketingConsentAt: null,
};

describe('consent', () => {
  it('validates kind, source and version', () => {
    expect(assertConsentKind('personal_data')).toBe('personal_data');
    expect(assertConsentKind('marketing')).toBe('marketing');
    expect(() => assertConsentKind('cookies')).toThrow(ValidationError);
    expect(assertConsentSource('web')).toBe('web');
    expect(() => assertConsentSource('sms')).toThrow(ValidationError);
    expect(normalizeConsentVersion(' 2026-09-25 ')).toBe('2026-09-25');
    expect(normalizeConsentVersion('v2.1')).toBe('v2.1');
    expect(() => normalizeConsentVersion('версия 1')).toThrow(ValidationError);
    expect(() => normalizeConsentVersion('')).toThrow(ValidationError);
  });

  it('requires consent text in both kk and ru', () => {
    expect(assertConsentText({ kk: ' Келісемін ', ru: 'Согласен' })).toEqual({ kk: 'Келісемін', ru: 'Согласен' });
    expect(() => assertConsentText({ ru: 'Согласен' })).toThrow(/kk and ru/);
    try {
      assertConsentText({ kk: 'Келісемін', ru: '  ' });
    } catch (e) {
      expect((e as ValidationError).details).toEqual({ missing: ['ru'] });
    }
  });

  it('applies consent and withdrawal to current flags per kind', () => {
    const at = new Date('2026-10-01T06:00:00Z');
    const granted = applyConsent(NO_CONSENT, { kind: 'personal_data', granted: true, version: 'v1', at });
    expect(granted).toMatchObject({ personalDataConsent: true, personalDataConsentVersion: 'v1', personalDataConsentAt: at, marketingConsent: false });
    const marketing = applyConsent(granted, { kind: 'marketing', granted: true, version: 'v1', at });
    expect(marketing.marketingConsent).toBe(true);
    const withdrawn = applyConsent(marketing, { kind: 'marketing', granted: false, version: 'v1', at });
    expect(withdrawn).toMatchObject({ personalDataConsent: true, marketingConsent: false });
  });

  it('current version is the latest published one', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const versions = [
      { version: 'v1', publishedAt: new Date('2026-09-25T00:00:00Z') },
      { version: 'v2', publishedAt: new Date('2026-09-30T00:00:00Z') },
      { version: 'v3', publishedAt: new Date('2026-10-05T00:00:00Z') },
    ];
    expect(currentVersion(versions, now)?.version).toBe('v2');
    expect(currentVersion([], now)).toBeNull();
  });
});
