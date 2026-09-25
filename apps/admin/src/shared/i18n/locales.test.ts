import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from '../api/error-messages';
import { kk } from './locales/kk';
import { ru } from './locales/ru';

function entries(obj: Record<string, unknown>, prefix = ''): Array<[string, string]> {
  return Object.entries(obj).flatMap(([key, value]): Array<[string, string]> =>
    value && typeof value === 'object' ? entries(value as Record<string, unknown>, `${prefix}${key}.`) : [[`${prefix}${key}`, String(value)]],
  );
}

describe('переводы админки', () => {
  it('казахский содержит все ключи русского и не пустой', () => {
    const ruKeys = entries(ru).map(([k]) => k).sort();
    const kkEntries = entries(kk as unknown as Record<string, unknown>);
    expect(kkEntries.map(([k]) => k).sort()).toEqual(ruKeys);
    expect(kkEntries.filter(([, v]) => !v.trim())).toEqual([]);
  });

  it('казахский перевод — не копия русского', () => {
    const kkMap = new Map(entries(kk as unknown as Record<string, unknown>));
    const same = entries(ru)
      .filter(([key, value]) => kkMap.get(key) === value && /[а-яё]{4,}/i.test(value))
      .map(([key]) => key);
    // Совпадают только названия языков, общие термины и значения для документов на русском.
    const allowed = ['languages.ru', 'languages.kk', 'translatable.kk', 'translatable.ru', 'layout.branch', 'layout.userMenu', 'roles.content_manager', 'legalEntities.defaults.directorPosition', 'legalEntities.defaults.actingBasis', 'integrations.categories.analytics', 'integrations.categories.delivery', 'legalEntities.bank', 'legalEntities.bankName', 'users.phone', 'branches.editTitle', 'branches.phone', 'system.logs.integration', 'system.logs.operation', 'branches.settings.paymentOnline', 'dashboard.subtitle', 'users.scope.branch', 'legalEntities.binHint', 'catalog.fields.isHalal', 'catalog.dishes.kcalUnit'];
    expect(same.filter((key) => !allowed.includes(key))).toEqual([]);
  });

  it('таблица ошибок: одинаковые коды для ru и kk', () => {
    expect(Object.keys(ERROR_MESSAGES.kk).sort()).toEqual(Object.keys(ERROR_MESSAGES.ru).sort());
  });
});
