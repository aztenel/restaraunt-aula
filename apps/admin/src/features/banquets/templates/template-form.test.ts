import { describe, expect, it } from 'vitest';
import { insertPlaceholder, TEMPLATE_CODE_PATTERN, templateVariables, unknownFromErrorDetails, unknownPlaceholders } from './template-form';

describe('подстановки шаблона договора', () => {
  const body = 'Договор № {{contract.number}} от {{ contract.date }}. Заказчик: {{client.name}}, {{client.nmae}}. Итого {{quote.total}} ({{contract.number}})';

  it('поиск подстановок в тексте (с пробелами внутри скобок, без повторов)', () => {
    expect(templateVariables(body)).toEqual(['contract.number', 'contract.date', 'client.name', 'client.nmae', 'quote.total']);
  });

  it('неизвестные подстановки подсвечиваются до сохранения', () => {
    expect(unknownPlaceholders(body, ['contract.number', 'contract.date', 'client.name', 'quote.total'])).toEqual(['client.nmae']);
    expect(unknownFromErrorDetails({ unknown: ['client.nmae', 1] })).toEqual(['client.nmae']);
    expect(unknownFromErrorDetails({})).toEqual([]);
  });

  it('вставка подстановки в позицию курсора', () => {
    expect(insertPlaceholder('Итого: .', 'quote.total', 7, 7)).toEqual({ body: 'Итого: {{quote.total}}.', caret: 22 });
    expect(insertPlaceholder('abc', 'x.y', null, null)).toEqual({ body: 'abc{{x.y}}', caret: 10 });
  });

  it('код шаблона', () => {
    expect(TEMPLATE_CODE_PATTERN.test('banquet-standard')).toBe(true);
    expect(TEMPLATE_CODE_PATTERN.test('Banquet')).toBe(false);
    expect(TEMPLATE_CODE_PATTERN.test('a')).toBe(false);
  });
});
