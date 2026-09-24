import { describe, expect, it } from 'vitest';
import { formatMoney, parseTengeToTiyn } from '@aula/api-client';
import { formatPhone, formatPrice, telHref, whatsappHref } from '@/lib/format';
import { endsNextDay, weekdayInTimeZone } from '@/lib/hours';

const NNBSP = ' ';
const NBSP = ' ';

describe('formatPrice (суммы от сервера в тиынах)', () => {
  it('форматирует тиыны в тенге с разделителями разрядов', () => {
    expect(formatPrice({ amount: 250000, currency: 'KZT' }, 'ru')).toBe(`2${NNBSP}500${NBSP}₸`);
    expect(formatPrice({ amount: 123456789, currency: 'KZT' }, 'kk')).toBe(`1${NNBSP}234${NNBSP}567,89${NBSP}₸`);
    expect(formatPrice({ amount: 99, currency: 'KZT' }, 'en')).toBe(`0.99${NBSP}₸`);
    expect(formatPrice(null, 'ru')).toBe('—');
  });

  it('отрицательные суммы (скидки, возвраты) — с типографским минусом', () => {
    expect(formatMoney({ amount: -150000, currency: 'KZT' }, 'ru')).toBe(`−1${NNBSP}500${NBSP}₸`);
  });

  it('разбор ввода и форматирование согласованы', () => {
    const parsed = parseTengeToTiyn('2 500,50');
    expect(parsed).toEqual({ ok: true, value: 250050 });
    expect(formatMoney({ amount: 250050, currency: 'KZT' }, 'ru')).toBe(`2${NNBSP}500,50${NBSP}₸`);
  });
});

describe('контакты', () => {
  it('ссылки tel: и WhatsApp', () => {
    expect(telHref('+7 (717) 200-00-00')).toBe('tel:+77172000000');
    expect(whatsappHref('+7 701 000 00 00', 'Привет')).toBe('https://wa.me/77010000000?text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82');
    expect(formatPhone('+77172000000')).toBe('+7 717 200 00 00');
    expect(formatPhone('12345')).toBe('12345');
  });
});

describe('часы работы (отображение)', () => {
  it('интервал через полночь', () => {
    expect(endsNextDay({ open: '10:00', close: '02:00' })).toBe(true);
    expect(endsNextDay({ open: '10:00', close: '00:00' })).toBe(false);
    expect(endsNextDay({ open: '10:00', close: '23:00' })).toBe(false);
  });

  it('день недели в часовом поясе филиала', () => {
    // 2026-09-27 20:00 UTC — в Астане (UTC+5) уже понедельник 28-го.
    expect(weekdayInTimeZone(new Date('2026-09-27T20:00:00Z'), 'Asia/Almaty')).toBe('mon');
    expect(weekdayInTimeZone(new Date('2026-09-27T20:00:00Z'), 'UTC')).toBe('sun');
  });
});
