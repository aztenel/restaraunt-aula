import { describe, expect, it } from 'vitest';
import { redactDeep, redactText, SecretRedaction } from './redaction';

describe('redaction for integration logs', () => {
  it('masks secrets in URLs, form bodies and bot tokens', () => {
    expect(redactText('https://api.mobizon.kz/x?output=json&apiKey=abc123&api=v1')).toBe('https://api.mobizon.kz/x?output=json&apiKey=***&api=v1');
    expect(redactText('login=aula&psw=secret&phones=7701')).toBe('login=aula&psw=***&phones=7701');
    expect(redactText('https://api.telegram.org/bot123:AAH-x_y/sendMessage')).toBe('https://api.telegram.org/bot***/sendMessage');
  });

  it('removes values of sensitive parameters anywhere in the structure', async () => {
    const value = { body: { template: { components: [{ parameters: [{ text: '582941' }] }] } }, note: 'code 582941 sent', n: 5 };
    expect(redactDeep(value, ['582941'])).toEqual({ body: { template: { components: [{ parameters: [{ text: '***' }] }] } }, note: 'code *** sent', n: 5 });
    expect(redactDeep(new URLSearchParams({ mes: 'код 5829', psw: 'x' }), ['5829'])).toBe('mes=%D0%BA%D0%BE%D0%B4+***&psw=***');
    await SecretRedaction.run(['7777', '12'], async () => {
      expect(SecretRedaction.current()).toEqual(['7777']);
    });
    expect(SecretRedaction.current()).toEqual([]);
  });
});
