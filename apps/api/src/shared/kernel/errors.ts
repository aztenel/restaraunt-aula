/**
 * Доменные ошибки. Любая бизнес-ошибка — наследник DomainError с машинно-читаемым кодом.
 * HTTP-слой (shared/infrastructure/http) переводит их в коды ответа, модули про HTTP не знают.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = new.target.name;
  }
}

/** Бизнес-правило нарушено входными данными (422). */
export class ValidationError extends DomainError {}

/** Объект не найден (404). */
export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string, details?: Record<string, unknown>) {
    super(`${entity}.not_found`, id ? `${entity} ${id} not found` : `${entity} not found`, { ...details, id });
  }
}

/** Конфликт состояния: занято, дубликат, гонка (409). */
export class ConflictError extends DomainError {}

/** Недопустимый переход конечного автомата (409). */
export class InvalidStateTransitionError extends DomainError {
  constructor(machine: string, from: string, to: string) {
    super(`${machine}.invalid_transition`, `${machine}: transition ${from} -> ${to} is not allowed`, { from, to });
  }
}

/** Требуется вход (401). */
export class UnauthenticatedError extends DomainError {
  constructor(code = 'auth.required', message = 'Authentication required') {
    super(code, message);
  }
}

/** Нет прав на действие (403). */
export class ForbiddenError extends DomainError {
  constructor(code = 'access.forbidden', message?: string, details?: Record<string, unknown>) {
    super(code, message ?? 'Access denied', details);
  }
}

/** Слишком много попыток (429). */
export class TooManyRequestsError extends DomainError {}

/** Нарушен инвариант, который не должен нарушаться при корректном коде (500). */
export class InvariantViolationError extends DomainError {}

export function invariant(condition: unknown, code: string, message?: string): asserts condition {
  if (!condition) {
    throw new InvariantViolationError(code, message);
  }
}
