import { describe, expect, it } from 'vitest';
import { hmacSha256 } from '../../../../shared/infrastructure/crypto/secret-box';
import { halykInvoiceId, mapHalykStatus } from './halyk/halyk.gateway';
import { escapeHtml } from './html';
import { mapKaspiStatus, verifyKaspiSignature } from './kaspi/kaspi.gateway';

describe('payment adapters helpers', () => {
  it('maps Halyk transaction statuses', () => {
    expect(mapHalykStatus('CHARGE')).toBe('succeeded');
    expect(mapHalykStatus('AUTH')).toBe('succeeded');
    expect(mapHalykStatus('CANCEL')).toBe('cancelled');
    expect(mapHalykStatus('REJECT')).toBe('failed');
    expect(mapHalykStatus('NEW')).toBe('pending');
    expect(mapHalykStatus(undefined)).toBe('pending');
    expect(halykInvoiceId(100123)).toBe('100123');
    expect(halykInvoiceId(42)).toBe('000042');
  });

  it('maps Kaspi statuses with overrides from settings', () => {
    expect(mapKaspiStatus('PAID')).toBe('succeeded');
    expect(mapKaspiStatus('Declined')).toBe('failed');
    expect(mapKaspiStatus('expired')).toBe('cancelled');
    expect(mapKaspiStatus('Wait')).toBe('pending');
    expect(mapKaspiStatus('Wait', { Wait: 'failed' })).toBe('failed');
  });

  it('verifies Kaspi HMAC signatures (hex, sha256= prefix, base64)', () => {
    const secret = 'secret-secret-secret';
    const body = '{"paymentId":"kp-1","status":"PAID"}';
    expect(verifyKaspiSignature(secret, body, hmacSha256(secret, body, 'hex'))).toBe(true);
    expect(verifyKaspiSignature(secret, body, `sha256=${hmacSha256(secret, body, 'hex').toUpperCase()}`)).toBe(true);
    expect(verifyKaspiSignature(secret, body, hmacSha256(secret, body, 'base64'))).toBe(true);
    expect(verifyKaspiSignature(secret, `${body} `, hmacSha256(secret, body, 'hex'))).toBe(false);
    expect(verifyKaspiSignature(secret, body, undefined)).toBe(false);
  });

  it('escapes html', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
