import { describe, expect, it } from 'vitest';
import { toCompanyInput, validateCompany } from './company-form';

describe('реквизиты компании-заказчика', () => {
  it('подсказки валидации — теми же правилами, что на сервере', () => {
    expect(validateCompany({ name: ' ', bin: '1234', legalAddress: '' }).map((i) => i.issue)).toEqual(['nameRequired', 'binInvalid', 'legalAddressRequired']);
    expect(
      validateCompany({
        name: 'ТОО «Ромашка»',
        bin: '940 140 001 234',
        legalAddress: 'Астана',
        iban: 'KZ12 3456',
        bik: 'CASP',
        kbe: '1',
        contactEmail: 'нет',
      }).map((i) => [i.field, i.issue]),
    ).toEqual([
      ['iban', 'ibanInvalid'],
      ['bik', 'bikInvalid'],
      ['kbe', 'kbeInvalid'],
      ['contactEmail', 'emailInvalid'],
    ]);
  });

  it('форма → API: коды нормализуются, пустые необязательные поля не отправляются', () => {
    const values = {
      name: ' ТОО «Ромашка» ',
      bin: '940 140 001 234',
      legalAddress: ' г. Астана, пр. Мангилик Ел, 1 ',
      iban: 'kz12 3456 7890 1234 5678',
      bik: 'caspkzka',
      kbe: '17',
      directorName: '',
      contactEmail: ' Buh@Romashka.KZ ',
    };
    expect(validateCompany(values)).toEqual([]);
    expect(toCompanyInput(values)).toEqual({
      name: 'ТОО «Ромашка»',
      bin: '940140001234',
      legalAddress: 'г. Астана, пр. Мангилик Ел, 1',
      bankName: undefined,
      iban: 'KZ123456789012345678',
      bik: 'CASPKZKA',
      kbe: '17',
      directorName: undefined,
      directorPosition: undefined,
      actingBasis: undefined,
      contactName: undefined,
      contactPhone: undefined,
      contactEmail: 'buh@romashka.kz',
    });
  });
});
