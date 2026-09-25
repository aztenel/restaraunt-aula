import { describe, expect, it } from 'vitest';
import { ApiError } from '@aula/api-client';
import { errorMessage } from '@/shared/api/errors';

describe('загрузка изображения больше лимита (413)', () => {
  it('сервер отвечает кодом catalog.image_too_large — понятный текст про 10 МБ', () => {
    const error = ApiError.fromResponse(413, { error: { code: 'catalog.image_too_large', message: 'Payload too large', details: { maxBytes: 10485760 } }, requestId: 'r1' });
    expect(error.status).toBe(413);
    expect(errorMessage(error, 'ru')).toBe('Файл изображения — не больше 10 МБ');
    expect(errorMessage(error, 'kk')).toBe('Сурет файлы — 10 МБ-тан аспауы керек');
  });

  it('413 от прокси без тела API — общий текст «файл слишком большой»', () => {
    expect(errorMessage(ApiError.fromResponse(413, '<html>413 Request Entity Too Large</html>'), 'ru')).toBe('Файл слишком большой');
  });
});
