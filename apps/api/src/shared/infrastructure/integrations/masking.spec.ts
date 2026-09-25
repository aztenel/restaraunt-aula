import { describe, expect, it } from 'vitest';
import { maskSensitive, maskString } from './masking';

describe('masking', () => {
  it('masks card numbers and sensitive keys', () => {
    expect(maskString('card 4400430012345678 ok')).toBe('card 440043******5678 ok');
    expect(maskSensitive({ password: 'secret-value', apiLogin: 'abcdef', nested: { access_token: 'tok12345' }, amount: 100 })).toEqual({
      password: '***alue',
      apiLogin: '***cdef',
      nested: { access_token: '***2345' },
      amount: 100,
    });
  });

  it('masks secrets inside SOAP/XML bodies', () => {
    const xml =
      '<soap:Header><wsse:UsernameToken><wsse:Username>123456789012</wsse:Username><wsse:Password Type="PasswordText">S3cr3t!</wsse:Password></wsse:UsernameToken></soap:Header><password>x</password>';
    const masked = maskString(xml);
    expect(masked).not.toContain('S3cr3t!');
    expect(masked).toContain('<wsse:Password Type="PasswordText">***</wsse:Password>');
    expect(masked).toContain('<password>***</password>');
    expect(masked).toContain('<wsse:Username>123456789012</wsse:Username>');
  });
});
