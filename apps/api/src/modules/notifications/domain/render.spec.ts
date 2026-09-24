import { describe, expect, it } from 'vitest';
import { renderText, textToHtml, unknownVariables } from './render';
import { smsInfo } from './sms';

describe('renderText', () => {
  it('substitutes parameters and collapses whitespace', () => {
    expect(renderText('Заказ  №{{number}}  готов. {{ extra }}', { number: 'GL-1' })).toBe('Заказ №GL-1 готов.');
  });

  it('drops label-only lines whose variables are empty, keeps static lines', () => {
    const template = 'Здравствуйте!\n\nКод: {{code}}\nПожелание: {{message}}\n{{note}}\n\nАдрес:\nул. Абая, 1';
    expect(renderText(template, { code: 'AB12', message: '', note: ' ' })).toBe('Здравствуйте!\n\nКод: AB12\n\nАдрес:\nул. Абая, 1');
  });

  it('keeps a line when at least one of its variables has a value', () => {
    expect(renderText('Сумма: {{amount}} {{currency}}', { amount: '100', currency: '' })).toBe('Сумма: 100');
  });

  it('reports variables that are not declared', () => {
    expect(unknownVariables('{{number}} {{total}} {{secret}} {{number}}', ['number', 'total'])).toEqual(['secret']);
  });

  it('builds escaped HTML with clickable links', () => {
    const html = textToHtml('Привет, <b>гость</b>!\nСтатус: https://aula.kz/t/1?a=1&b=2\n\nСпасибо', 'Тема');
    expect(html).toContain('Привет, &lt;b&gt;гость&lt;/b&gt;!<br>');
    expect(html).toContain('<a href="https://aula.kz/t/1?a=1&amp;b=2"');
    expect(html).toContain('<p style="margin:0 0 16px">Спасибо</p>');
    expect(html).not.toContain('<b>');
  });
});

describe('smsInfo', () => {
  it('latin text is GSM-7: 160 per single message, 153 per part', () => {
    expect(smsInfo('A'.repeat(160))).toEqual({ encoding: 'gsm7', length: 160, segments: 1 });
    expect(smsInfo('A'.repeat(161))).toEqual({ encoding: 'gsm7', length: 161, segments: 2 });
    expect(smsInfo('{}').length).toBe(4);
  });

  it('cyrillic and kazakh letters switch to UCS-2: 70 per message, 67 per part', () => {
    expect(smsInfo('Қ'.repeat(70))).toEqual({ encoding: 'ucs2', length: 70, segments: 1 });
    expect(smsInfo('Заказ'.repeat(15))).toEqual({ encoding: 'ucs2', length: 75, segments: 2 });
  });
});
