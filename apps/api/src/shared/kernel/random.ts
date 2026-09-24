import { randomBytes, randomInt } from 'node:crypto';

/** Алфавит без похожих символов (0/O, 1/I/L): 31 символ, ~4.95 бита энтропии на символ. */
export const UNAMBIGUOUS_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Криптостойкий код из алфавита. */
export function randomCode(length: number, alphabet: string = UNAMBIGUOUS_ALPHABET): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[randomInt(alphabet.length)];
  }
  return out;
}

/** Числовой одноразовый код (OTP). */
export function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(randomInt(10));
  return out;
}

/** Непредсказуемый публичный токен для ссылок (заказ, смета, бронь). */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}
