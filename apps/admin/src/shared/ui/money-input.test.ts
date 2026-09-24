import { describe, expect, it } from 'vitest';
import { formatMoney, formatTiyn } from '@aula/api-client';
import { moneyToDisplayText, moneyToInputText, parseMoneyInput } from './money-input';

const NNBSP = ' ';
const NBSP = ' ';

describe('parseMoneyInput: тенге строкой → тиыны (без float)', () => {
  it.each([
    ['2500', 250000],
    ['2 500', 250000],
    [`2${NNBSP}500`, 250000],
    ['2500,5', 250050],
    ['2500.50', 250050],
    ['0,05', 5],
    [',5', 50],
    ['  1 000 000 ₸ ', 100000000],
    ['007', 700],
    ['0', 0],
  ])('%s → %d', (input, expected) => {
    expect(parseMoneyInput(input)).toEqual({ value: expected, error: null });
  });

  it('точно для значений, неточных в двоичной плавающей точке', () => {
    // 0.1 + 0.2 !== 0.3 во float, но разбор строки — по цифрам.
    expect(parseMoneyInput('0,3').value).toBe(30);
    expect(parseMoneyInput('1.15').value).toBe(115);
    expect(parseMoneyInput('4.35').value).toBe(435);
    expect(parseMoneyInput('9007199254740.99').value).toBe(900719925474099);
  });

  it('пустое поле — null без ошибки', () => {
    expect(parseMoneyInput('')).toEqual({ value: null, error: null });
    expect(parseMoneyInput('   ')).toEqual({ value: null, error: null });
  });

  it('ошибки формата', () => {
    expect(parseMoneyInput('12,345').error).toBe('too_many_decimals');
    expect(parseMoneyInput('abc').error).toBe('invalid');
    expect(parseMoneyInput('1,2,3').error).toBe('invalid');
    expect(parseMoneyInput('-100').error).toBe('negative');
    expect(parseMoneyInput('-100', { allowNegative: true })).toEqual({ value: -10000, error: null });
    expect(parseMoneyInput('100', { max: 5000 }).error).toBe('too_large');
    expect(parseMoneyInput('99999999999999999999').error).toBe('too_large');
  });
});

describe('отображение в поле', () => {
  it('для редактирования — без разделителей разрядов', () => {
    expect(moneyToInputText(250000)).toBe('2500');
    expect(moneyToInputText(250050)).toBe('2500,50');
    expect(moneyToInputText(250050, 'en')).toBe('2500.50');
    expect(moneyToInputText(null)).toBe('');
  });

  it('после ввода — с разделителями, без знака валюты', () => {
    expect(moneyToDisplayText(123456789)).toBe(`1${NNBSP}234${NNBSP}567,89`);
    expect(moneyToDisplayText(undefined)).toBe('');
  });

  it('туда и обратно без потерь', () => {
    for (const tiyn of [0, 1, 99, 100, 250050, 123456789, 900719925474099]) {
      expect(parseMoneyInput(moneyToInputText(tiyn)).value).toBe(tiyn);
      expect(parseMoneyInput(moneyToDisplayText(tiyn)).value).toBe(tiyn);
    }
  });
});

describe('formatMoney', () => {
  it('«2 500 ₸»: тиыны / 100, без копеек для целых сумм', () => {
    expect(formatMoney({ amount: 250000, currency: 'KZT' }, 'ru')).toBe(`2${NNBSP}500${NBSP}₸`);
    expect(formatMoney({ amount: 250050, currency: 'KZT' }, 'kk')).toBe(`2${NNBSP}500,50${NBSP}₸`);
    expect(formatMoney({ amount: 100, currency: 'KZT' }, 'ru')).toBe(`1${NBSP}₸`);
    expect(formatMoney({ amount: 0, currency: 'KZT' }, 'ru')).toBe(`0${NBSP}₸`);
    expect(formatMoney({ amount: 999, currency: 'KZT' }, 'ru')).toBe(`9,99${NBSP}₸`);
    expect(formatMoney({ amount: 100000000000, currency: 'KZT' }, 'ru')).toBe(`1${NNBSP}000${NNBSP}000${NNBSP}000${NBSP}₸`);
  });

  it('отрицательные, пустые, без валюты, всегда с тиынами', () => {
    expect(formatMoney({ amount: -50, currency: 'KZT' }, 'ru')).toBe(`−0,50${NBSP}₸`);
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined, 'ru', { empty: '' })).toBe('');
    expect(formatMoney({ amount: 250000, currency: 'KZT' }, 'ru', { withCurrency: false })).toBe(`2${NNBSP}500`);
    expect(formatMoney({ amount: 250000, currency: 'KZT' }, 'ru', { alwaysShowMinor: true })).toBe(`2${NNBSP}500,00${NBSP}₸`);
    expect(formatTiyn(12345, 'en')).toBe(`123.45${NBSP}₸`);
  });
});
