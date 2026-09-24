import { maskPhone } from '../../../shared/kernel/phone';
import { NotificationChannel } from '../public';

/**
 * Маскирование адресатов и чувствительных параметров для журнала доставки и логов:
 * телефон +7 701 *** ** 67, почта ai***@mail.kz, чат Telegram ***4567.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}***${email.slice(at)}`;
}

export function maskChatId(chatId: string): string {
  return chatId.length <= 4 ? '***' : `***${chatId.slice(-4)}`;
}

export function maskAddress(channel: NotificationChannel, address: string | null | undefined): string {
  if (!address) return '—';
  switch (channel) {
    case 'whatsapp':
    case 'sms':
      return maskPhone(address);
    case 'email':
      return maskEmail(address);
    case 'telegram':
      return maskChatId(address);
    default:
      return '***';
  }
}

export const MASKED_VALUE = '***';

/** Параметры для журнала: значения чувствительных параметров заменены на ***. */
export function maskParams(params: Record<string, string>, sensitive: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) out[k] = sensitive.includes(k) ? MASKED_VALUE : v;
  return out;
}

/** Разделить параметры на открытые (с масками) и секретные (хранятся зашифрованными). */
export function splitSensitiveParams(
  params: Record<string, string>,
  sensitive: readonly string[],
): { visible: Record<string, string>; secret: Record<string, string> } {
  const secret: Record<string, string> = {};
  for (const key of sensitive) {
    if (params[key] !== undefined) secret[key] = params[key]!;
  }
  return { visible: maskParams(params, sensitive), secret };
}
