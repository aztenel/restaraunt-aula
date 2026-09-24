/**
 * Расчёт длины SMS: кодировка GSM-7 (латиница) — 160 символов в одном сообщении, 153 в части
 * составного; UCS-2 (кириллица, казахские буквы) — 70 и 67. Нужна для предпросмотра шаблонов
 * в админке: оператор видит, во сколько частей (и тарифицируемых SMS) уйдёт текст.
 */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';

const BASIC = new Set([...GSM7_BASIC]);
const EXTENDED = new Set([...GSM7_EXTENDED]);

export interface SmsInfo {
  encoding: 'gsm7' | 'ucs2';
  /** Длина в единицах кодировки (символ расширенного набора GSM-7 считается за два). */
  length: number;
  segments: number;
}

export function smsInfo(text: string): SmsInfo {
  let gsmLength = 0;
  let isGsm = true;
  for (const ch of text) {
    if (BASIC.has(ch)) gsmLength += 1;
    else if (EXTENDED.has(ch)) gsmLength += 2;
    else {
      isGsm = false;
      break;
    }
  }
  if (isGsm) {
    return { encoding: 'gsm7', length: gsmLength, segments: gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153) };
  }
  // UCS-2 считает в 16-битных единицах (символ вне BMP — две единицы).
  const length = text.length;
  return { encoding: 'ucs2', length, segments: length <= 70 ? 1 : Math.ceil(length / 67) };
}
