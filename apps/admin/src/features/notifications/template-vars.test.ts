import { describe, expect, it } from 'vitest';
import { ApiError } from '@aula/api-client';
import { channelHint, insertVariable, issueFromApiError, segmentTemplate, templateVariables, unknownVariables, validateTemplateText } from './template-vars';

const allowed = ['number', 'total', 'trackingUrl'];

describe('переменные шаблонов уведомлений', () => {
  it('разбор {{param}} как на сервере (пробелы внутри скобок допустимы), без повторов', () => {
    expect(templateVariables('Заказ {{number}} на {{ total }}. {{number}}')).toEqual(['number', 'total']);
    expect(templateVariables('Нет переменных {не} {{}}')).toEqual([]);
  });

  it('неизвестные переменные', () => {
    expect(unknownVariables('Заказ {{number}}, курьер {{courier}}, {{ eta }}', allowed)).toEqual(['courier', 'eta']);
  });

  it('подсветка: текст, известные и неизвестные переменные', () => {
    expect(segmentTemplate('Заказ {{number}} — {{oops}}!', allowed)).toEqual([
      { text: 'Заказ ', kind: 'text' },
      { text: '{{number}}', kind: 'known' },
      { text: ' — ', kind: 'text' },
      { text: '{{oops}}', kind: 'unknown' },
      { text: '!', kind: 'text' },
    ]);
  });

  it('вставка переменной в позицию курсора', () => {
    expect(insertVariable('Заказ  готов', 6, 'number')).toEqual({ text: 'Заказ {{number}} готов', cursor: 16 });
    expect(insertVariable('Итого: ', null, 'total')).toEqual({ text: 'Итого: {{total}}', cursor: 16 });
  });

  it('проверка черновика: пустой текст, лимит канала, тема email, неизвестные переменные', () => {
    expect(validateTemplateText({ channel: 'sms', subject: null, body: ' ', allowed })).toEqual([{ code: 'body_required', field: 'body' }]);
    expect(validateTemplateText({ channel: 'sms', subject: null, body: 'x'.repeat(1001), allowed })).toEqual([{ code: 'too_long', field: 'body', limit: 1000 }]);
    expect(validateTemplateText({ channel: 'email', subject: 'Заказ {{nope}}', body: 'Итого {{total}} {{x}}', allowed })).toEqual([
      { code: 'unknown_variables', field: 'body', variables: ['x'] },
      { code: 'unknown_variables', field: 'subject', variables: ['nope'] },
    ]);
    expect(validateTemplateText({ channel: 'email', subject: '', body: 'ok', allowed })).toEqual([{ code: 'subject_required', field: 'subject' }]);
    expect(validateTemplateText({ channel: 'whatsapp', subject: null, body: 'Заказ {{number}}', allowed })).toEqual([]);
  });

  it('ошибка сервера → подсказка у поля со списком переменных', () => {
    const error = new ApiError({
      status: 400,
      code: 'notification_template.unknown_variables',
      details: { variables: ['courier'], allowed },
    });
    expect(issueFromApiError(error)).toEqual({ code: 'unknown_variables', field: 'body', variables: ['courier'] });
    expect(issueFromApiError(new ApiError({ status: 400, code: 'notification_template.too_long', details: { limit: 1024 } }))).toEqual({
      code: 'too_long',
      field: 'body',
      limit: 1024,
    });
    expect(issueFromApiError(new ApiError({ status: 403, code: 'access.forbidden' }))).toBeNull();
  });

  it('канал по адресу для тестовой отправки', () => {
    expect(channelHint('+7 701 123 45 67')).toBe('whatsapp');
    expect(channelHint('ops@aula.kz')).toBe('email');
    expect(channelHint('-1001234567890')).toBe('telegram');
    expect(channelHint('@aula_ops')).toBe('telegram');
    expect(channelHint('hello')).toBeNull();
  });
});
