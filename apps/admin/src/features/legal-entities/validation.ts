/**
 * Подсказки валидации реквизитов юрлица (сервер проверяет то же самое):
 * БИН — 12 цифр; IBAN (ИИК) — KZ + 2 цифры + 16 символов; БИК — SWIFT-формат; КБе — 2 цифры.
 */
export const BIN_PATTERN = /^\d{12}$/;
export const IBAN_PATTERN = /^KZ\d{2}[0-9A-Z]{16}$/;
export const BIK_PATTERN = /^[A-Z0-9]{8}([A-Z0-9]{3})?$/;
export const KBE_PATTERN = /^\d{2}$/;

/** Нормализация ввода: пробелы убираются, латиница — в верхний регистр. */
export function normalizeCode(value: string | undefined | null): string {
  return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

export function isValidBin(value: string): boolean {
  return BIN_PATTERN.test(normalizeCode(value));
}

export function isValidIban(value: string): boolean {
  const v = normalizeCode(value);
  return v === '' || IBAN_PATTERN.test(v);
}

export function isValidBik(value: string): boolean {
  const v = normalizeCode(value);
  return v === '' || BIK_PATTERN.test(v);
}
