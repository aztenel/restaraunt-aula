import { describe, expect, it } from 'vitest';
import { ApiError, NETWORK_ERROR_CODE, isApiErrorBody, toApiError } from '@aula/api-client';
import { errorMessage, messageForCode } from './errors';

describe('ApiError: формат ошибок API { error: { code, message, details }, requestId }', () => {
  it('разбирает тело ошибки', () => {
    const body = {
      error: { code: 'auth.locked', message: 'Account temporarily locked', details: { lockedUntil: '2026-09-25T10:15:00.000Z' } },
      requestId: 'req-1',
    };
    expect(isApiErrorBody(body)).toBe(true);
    const error = ApiError.fromResponse(403, body);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.code).toBe('auth.locked');
    expect(error.details.lockedUntil).toBe('2026-09-25T10:15:00.000Z');
    expect(error.requestId).toBe('req-1');
    expect(error.isForbidden).toBe(true);
  });

  it('ответ не в формате API (прокси, HTML) → http.<status>', () => {
    const error = ApiError.fromResponse(502, '<html>Bad gateway</html>', 'hdr-req');
    expect(error.code).toBe('http.502');
    expect(error.requestId).toBe('hdr-req');
    expect(ApiError.fromResponse(404, undefined).isNotFound).toBe(true);
  });

  it('ошибки валидации полей и 429', () => {
    const validation = ApiError.fromResponse(400, { error: { code: 'request.invalid', message: 'a; b', details: { fields: ['email must be an email', 42] } }, requestId: null });
    expect(validation.isValidation).toBe(true);
    expect(validation.fieldMessages).toEqual(['email must be an email']);
    const limited = ApiError.fromResponse(429, { error: { code: 'rate_limit.exceeded', message: 'x', details: { retryAfterSeconds: 30 } }, requestId: null });
    expect(limited.isRateLimited).toBe(true);
    expect(limited.retryAfterSeconds).toBe(30);
  });

  it('сетевые сбои', () => {
    const error = toApiError(new TypeError('Failed to fetch'));
    expect(error.code).toBe(NETWORK_ERROR_CODE);
    expect(error.isNetworkError).toBe(true);
    expect(toApiError(error)).toBe(error);
  });
});

describe('errorMessage: текст по коду ошибки', () => {
  it('известные коды на русском и казахском', () => {
    const invalid = ApiError.fromResponse(403, { error: { code: 'auth.invalid_credentials', message: 'Invalid email or password' }, requestId: null });
    expect(errorMessage(invalid, 'ru')).toBe('Неверный email или пароль');
    expect(errorMessage(invalid, 'kk')).toBe('Email немесе құпиясөз қате');
  });

  it('подставляет время блокировки и секунды ожидания', () => {
    const locked = ApiError.fromResponse(403, { error: { code: 'auth.locked', message: 'x', details: { lockedUntil: '2026-09-25T10:15:00.000Z' } }, requestId: null });
    // 10:15 UTC = 15:15 в Asia/Almaty (UTC+5)
    expect(errorMessage(locked, 'ru')).toContain('15:15');
    const limited = ApiError.fromResponse(429, { error: { code: 'rate_limit.exceeded', message: 'x', details: { retryAfterSeconds: 42 } }, requestId: null });
    expect(errorMessage(limited, 'ru')).toContain('42');
  });

  it('общие суффиксы и запасной вариант — сообщение сервера', () => {
    expect(errorMessage(ApiError.fromResponse(404, { error: { code: 'order.not_found', message: 'x' }, requestId: null }), 'ru')).toBe('Объект не найден');
    expect(errorMessage(ApiError.fromResponse(409, { error: { code: 'order.invalid_transition', message: 'x' }, requestId: null }), 'ru')).toBe('Недопустимая смена статуса');
    expect(errorMessage(ApiError.fromResponse(422, { error: { code: 'catalog.something_new', message: 'Понятное сообщение сервера' }, requestId: null }), 'ru')).toBe('Понятное сообщение сервера');
    expect(errorMessage(ApiError.fromResponse(503, 'down'), 'ru')).toBe('Сервер временно недоступен. Попробуйте позже');
    expect(errorMessage(new TypeError('Failed to fetch'), 'kk')).toBe('Сервермен байланыс жоқ. Интернет қосылымын тексеріңіз');
    expect(messageForCode('password.too_short', 'ru')).toBe('Пароль должен быть не короче 10 символов');
  });
});

describe('errorMessage: коды каталога и контента', () => {
  const err = (status: number, code: string, details?: Record<string, unknown>) =>
    ApiError.fromResponse(status, { error: { code, message: 'server text', details }, requestId: null });

  it('подставляет значения из details', () => {
    expect(errorMessage(err(409, 'catalog.category_not_empty', { dishCount: 4 }), 'ru')).toBe(
      'В категории есть блюда (4): сначала перенесите или удалите их',
    );
    expect(errorMessage(err(422, 'catalog.too_many_photos', { max: 10, existing: 9 }), 'kk')).toBe('Тағамда 10 фотодан аспауы керек');
    expect(errorMessage(err(409, 'catalog.sku_taken', { sku: 'BSH-01' }), 'ru')).toContain('BSH-01');
  });

  it('уточнение по details.reason, иначе общий текст кода', () => {
    expect(errorMessage(err(422, 'catalog.modifier_group_invalid', { reason: 'min_greater_than_max' }), 'ru')).toBe(
      'Минимум выбора не может быть больше максимума',
    );
    expect(errorMessage(err(422, 'catalog.modifier_group_invalid', { reason: 'something_new' }), 'ru')).toBe('Настройки группы модификаторов неверны');
  });

  it('защищённые страницы и стоп «до»', () => {
    expect(errorMessage(err(409, 'content.page_protected', { slug: 'offer' }), 'ru')).toContain('Юридическую страницу нельзя удалить');
    expect(errorMessage(err(422, 'catalog.stop_until_invalid'), 'kk')).toContain('30 күннен');
    expect(errorMessage(err(413, 'http.413'), 'ru')).toBe('Файл слишком большой');
  });
});
