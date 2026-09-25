import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import kk from '@/messages/kk.json';
import ru from '@/messages/ru.json';

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object' ? keys(value as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

function entries(obj: Record<string, unknown>, prefix = ''): Array<[string, string]> {
  return Object.entries(obj).flatMap(([key, value]): Array<[string, string]> =>
    value && typeof value === 'object'
      ? entries(value as Record<string, unknown>, `${prefix}${key}.`)
      : [[`${prefix}${key}`, String(value)]],
  );
}

function values(obj: Record<string, unknown>): string[] {
  return Object.values(obj).flatMap((v) => (v && typeof v === 'object' ? values(v as Record<string, unknown>) : [String(v)]));
}

describe('переводы витрины', () => {
  it('во всех языках одинаковый набор ключей', () => {
    const reference = keys(ru).sort();
    expect(keys(kk).sort()).toEqual(reference);
    expect(keys(en).sort()).toEqual(reference);
  });

  it('нет пустых строк', () => {
    for (const messages of [ru, kk, en]) {
      expect(values(messages).filter((v) => v.trim() === '')).toEqual([]);
    }
  });

  it('казахский перевод — не копия русского', () => {
    const ruEntries = entries(ru);
    const kkEntries = new Map(entries(kk));
    const same = ruEntries
      .filter(([key, value]) => kkEntries.get(key) === value && /[а-яё]/i.test(value))
      .map(([key]) => key);
    // Совпадать могут только названия языков и слова, одинаковые в обоих языках.
    const allowed = [
      'Languages.kk',
      'Languages.ru',
      'Home.featureHalalTitle',
      'Header.branch',
      'Menu.branchLabel',
      'Branches.mapAria',
      // «Филиал», «Промокод», «Халал», единицы «г» и «ккал» пишутся по-казахски так же.
      'Cart.branchLabel',
      'Cart.promoLabel',
      'Dish.weight',
      'Dish.calories',
      'Dish.halal',
      'Filters.halal',
      // «Телефон», «Промокод», «Домофон», «Депозит», «Бюджет», «Банк», «Кбе», «Корпоратив» — так же по-казахски;
      // «Құдалық» — казахское слово и в русском тексте.
      'Checkout.phone',
      'Checkout.promo',
      'Checkout.address.intercom',
      'Booking.branch',
      'Booking.deposit',
      'Booking.depositLabel',
      'Booking.phone',
      'BookingStatus.depositTitle',
      'Banquets.formats.corporate.title',
      'Banquets.formats.kudalyk.title',
      'Banquets.types.corporate',
      'Banquets.types.kudalyk',
      'Banquets.form.budget',
      'Banquets.form.phone',
      'BanquetInvoice.requisites.bank',
      'BanquetInvoice.requisites.kbe',
    ];
    expect(same.filter((key) => !allowed.includes(key))).toEqual([]);
  });
});
