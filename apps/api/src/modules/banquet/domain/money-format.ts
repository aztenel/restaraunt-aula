import { MINOR_UNITS_PER_MAJOR, Money } from '../../../shared/kernel/money';

/**
 * Форматирование сумм для документов (PDF, XML ЭСФ) и сообщений гостю. Только целочисленная арифметика.
 * Фронтенд форматирует суммы сам — API отдаёт { amount, currency }.
 */

/** 150050 тиынов -> «1500.50» (формат сумм в XML ЭСФ). */
export function toMajorString(money: Money): string {
  const sign = money.amount < 0 ? '-' : '';
  const abs = Math.abs(money.amount);
  const major = Math.floor(abs / MINOR_UNITS_PER_MAJOR);
  const minor = abs % MINOR_UNITS_PER_MAJOR;
  return `${sign}${major}.${String(minor).padStart(2, '0')}`;
}

/** «5 000 ₸», «1 500,50 ₸». */
export function formatTenge(money: Money): string {
  const sign = money.amount < 0 ? '-' : '';
  const abs = Math.abs(money.amount);
  const major = Math.floor(abs / MINOR_UNITS_PER_MAJOR);
  const minor = abs % MINOR_UNITS_PER_MAJOR;
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const symbol = money.currency === 'KZT' ? '₸' : money.currency;
  return minor === 0 ? `${sign}${grouped} ${symbol}` : `${sign}${grouped},${String(minor).padStart(2, '0')} ${symbol}`;
}

/** Процент из базисных пунктов: 1600 -> «16», 1250 -> «12,5». */
export function formatPercent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return String(whole);
  return `${whole},${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** Целочисленное деление суммы с округлением half-up (сумма на гостя). */
export function divideMoney(money: Money, divisor: number): Money {
  if (!Number.isSafeInteger(divisor) || divisor <= 0) return Money.zero(money.currency);
  const sign = money.amount < 0 ? -1 : 1;
  const abs = Math.abs(money.amount);
  const rounded = Math.floor((2 * abs + divisor) / (2 * divisor));
  return Money.of(sign * rounded, money.currency);
}

// ---------------------------------------------------------------- сумма прописью (счета, акты)

const ONES_MASC = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_FEM = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

interface Scale {
  forms: [string, string, string];
  feminine: boolean;
}

const SCALES: Scale[] = [
  { forms: ['', '', ''], feminine: false },
  { forms: ['тысяча', 'тысячи', 'тысяч'], feminine: true },
  { forms: ['миллион', 'миллиона', 'миллионов'], feminine: false },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], feminine: false },
  { forms: ['триллион', 'триллиона', 'триллионов'], feminine: false },
];

/** Форма слова для числа: 1 тысяча, 2 тысячи, 5 тысяч. */
export function pluralRu(n: number, forms: readonly [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 19) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function triadWords(n: number, feminine: boolean): string[] {
  const words: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) words.push(HUNDREDS[h]!);
  if (rest >= 10 && rest <= 19) {
    words.push(TEENS[rest - 10]!);
  } else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (t > 0) words.push(TENS[t]!);
    if (o > 0) words.push((feminine ? ONES_FEM : ONES_MASC)[o]!);
  }
  return words;
}

/** Целое неотрицательное число прописью (мужской род): 123 -> «сто двадцать три». */
export function integerInWordsRu(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Cannot spell ${value}`);
  if (value === 0) return 'ноль';
  const parts: string[] = [];
  let rest = value;
  let scale = 0;
  while (rest > 0) {
    const triad = rest % 1000;
    if (triad > 0) {
      const s = SCALES[scale];
      if (!s) throw new Error(`Number ${value} is too large`);
      const words = triadWords(triad, s.feminine);
      if (scale > 0) words.push(pluralRu(triad, s.forms));
      parts.unshift(words.join(' '));
    }
    rest = Math.floor(rest / 1000);
    scale += 1;
  }
  return parts.join(' ');
}

/** «Сто двадцать три тысячи тенге 50 тиын» — сумма прописью для счёта и акта. */
export function amountInWordsRu(money: Money): string {
  const abs = Math.abs(money.amount);
  const major = Math.floor(abs / MINOR_UNITS_PER_MAJOR);
  const minor = abs % MINOR_UNITS_PER_MAJOR;
  const words = integerInWordsRu(major);
  const currency = money.currency === 'KZT' ? 'тенге' : money.currency;
  const minorUnit = money.currency === 'KZT' ? 'тиын' : '';
  const text = `${words} ${currency} ${String(minor).padStart(2, '0')} ${minorUnit}`.trim();
  return `${money.amount < 0 ? 'минус ' : ''}${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
