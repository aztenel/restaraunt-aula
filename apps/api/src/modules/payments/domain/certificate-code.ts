import { randomCode, UNAMBIGUOUS_ALPHABET } from '../../../shared/kernel/random';

/**
 * Код подарочного сертификата: 12 символов из алфавита без похожих символов (0/O, 1/I/L),
 * формат XXXX-XXXX-XXXX (~59 бит энтропии). В БД хранится только HMAC-хэш и последние 4 символа.
 */
export const CERTIFICATE_CODE_LENGTH = 12;
const GROUP = 4;

/** Новый код в формате XXXX-XXXX-XXXX. */
export function generateCertificateCode(): string {
  return formatCertificateCode(randomCode(CERTIFICATE_CODE_LENGTH, UNAMBIGUOUS_ALPHABET));
}

/**
 * Нормализация ввода гостя/кассира: регистр, пробелы и дефисы не важны.
 * Возвращает 12 символов без дефисов или null, если код заведомо некорректен.
 */
export function normalizeCertificateCode(input: string | null | undefined): string | null {
  const compact = String(input ?? '')
    .toUpperCase()
    .replace(/[\s\-_–—]/g, '');
  if (compact.length !== CERTIFICATE_CODE_LENGTH) return null;
  for (const ch of compact) {
    if (!UNAMBIGUOUS_ALPHABET.includes(ch)) return null;
  }
  return compact;
}

/** 'ABCDEFGHJKLM' -> 'ABCD-EFGH-JKLM'. */
export function formatCertificateCode(normalized: string): string {
  const parts: string[] = [];
  for (let i = 0; i < normalized.length; i += GROUP) parts.push(normalized.slice(i, i + GROUP));
  return parts.join('-');
}

export function certificateCodeLast4(normalized: string): string {
  return normalized.slice(-4);
}

/** Маскированный код для админки и ответов: ****-****-AB12. */
export function maskCertificateCode(last4: string): string {
  return `****-****-${last4}`;
}

/** Строка для HMAC: префикс отделяет хэши кодов сертификатов от других HMAC приложения. */
export function certificateHashInput(normalized: string): string {
  return `gift-certificate:${normalized}`;
}
