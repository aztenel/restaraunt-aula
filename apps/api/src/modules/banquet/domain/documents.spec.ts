import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { normalizeCompany } from './company';
import { contractParams, renderContract, validateTemplateBody } from './contract-template';
import { buildEsfInvoice, esfRequired } from './esf';
import { buyerFromCompany, buyerFromContact, SellerSnapshot } from './requisites';

const seller: SellerSnapshot = {
  name: 'ТОО «Express kitchen»',
  shortName: 'Express kitchen',
  bin: '123456789012',
  legalAddress: 'г. Астана, пр. Кабанбай батыра, 56',
  actualAddress: null,
  directorName: 'Иванов И.И.',
  directorPosition: 'Директор',
  actingBasis: 'Устава',
  bankName: 'АО «Банк»',
  iban: 'KZ000000000000000000',
  bik: 'BANKKZKA',
  kbe: '17',
  vatPayer: true,
  vatRateBp: 1600,
  vatCertificate: null,
  phone: '+77172000000',
  email: 'info@aula.kz',
};

const contact = { customerId: 'c1', name: 'Айгерим', phone: '+77771234567', email: null };

describe('normalizeCompany', () => {
  it('normalizes requisites', () => {
    const c = normalizeCompany({
      name: ' ТОО «Ромашка» ',
      bin: '9401 4000 1234',
      legalAddress: 'Астана, ул. Кенесары 1',
      iban: 'kz12 3456 7890 1234 5678',
      bik: 'caspkzka',
      kbe: '17',
      contactPhone: '8 701 111 22 33',
      contactEmail: 'ACC@Romashka.kz',
    });
    expect(c).toMatchObject({
      name: 'ТОО «Ромашка»',
      bin: '940140001234',
      iban: 'KZ123456789012345678',
      bik: 'CASPKZKA',
      contactPhone: '+77011112233',
      contactEmail: 'acc@romashka.kz',
      bankName: null,
    });
  });

  it('rejects invalid BIN, IBAN, BIK, KBE', () => {
    const base = { name: 'ТОО', bin: '123456789012', legalAddress: 'Астана' };
    const code = (patch: Record<string, string>) => {
      try {
        normalizeCompany({ ...base, ...patch });
      } catch (err) {
        return (err as ValidationError).code;
      }
      return null;
    };
    expect(code({ bin: '12345' })).toBe('banquet_company.invalid_bin');
    expect(code({ iban: 'DE89370400440532013000' })).toBe('banquet_company.invalid_iban');
    expect(code({ bik: 'X' })).toBe('banquet_company.invalid_bik');
    expect(code({ kbe: '1' })).toBe('banquet_company.invalid_kbe');
    expect(code({ legalAddress: ' ' })).toBe('banquet_company.field_required');
  });
});

describe('contract templates', () => {
  it('validates placeholders', () => {
    expect(validateTemplateBody('Договор № {{contract.number}} с {{client.name}}')).toContain('{{client.name}}');
    try {
      validateTemplateBody('Договор № {{contract.number}} с {{client.nmae}} и {{foo}}');
      throw new Error('expected failure');
    } catch (err) {
      expect((err as ValidationError).code).toBe('banquet_template.unknown_placeholders');
      expect((err as ValidationError).details?.unknown).toEqual(['client.nmae', 'foo']);
    }
    expect(() => validateTemplateBody('short')).toThrow(/Template must be/);
  });

  it('renders requisites, event and money into the contract', () => {
    const company = normalizeCompany({ name: 'ТОО «Ромашка»', bin: '940140001234', legalAddress: 'Астана, ул. Кенесары 1', directorName: 'Петров П.П.' });
    const ctx = {
      contract: { number: 'GL-D-2026-000001', date: '2026-10-01' },
      requestNumber: 'GL-B-2026-000001',
      seller,
      client: buyerFromCompany('co1', company, contact),
      event: { date: '2026-10-20', time: '18:00', typeLabel: 'Корпоратив', guests: 50, place: 'AULA GreenLine', venue: 'VIP-зал' },
      quote: { version: 2, total: Money.tenge(1_160_000), vat: Money.tenge(160_000), perGuest: Money.tenge(23_200) },
      prepayment: Money.tenge(580_000),
      manager: { name: 'Менеджер', phone: '+77010000000' },
    };
    const text = renderContract(
      'Договор {{contract.number}} от {{contract.date}}. {{seller.name}} (БИН {{seller.bin}}) и {{client.name}} (БИН {{client.bin}}), ' +
        'в лице {{client.directorName}}. Мероприятие {{event.date}} {{event.time}}, {{event.guests}} гостей. Итого {{quote.total}} ' +
        '({{quote.totalWords}}), {{seller.vat}}. Предоплата {{prepayment.amount}}. {{client.iban}}',
      ctx,
    );
    expect(text).toBe(
      'Договор GL-D-2026-000001 от 01.10.2026. ТОО «Express kitchen» (БИН 123456789012) и ТОО «Ромашка» (БИН 940140001234), ' +
        'в лице Петров П.П.. Мероприятие 20.10.2026 18:00, 50 гостей. Итого 1 160 000 ₸ ' +
        '(Один миллион сто шестьдесят тысяч тенге 00 тиын), в т.ч. НДС 16%. Предоплата 580 000 ₸. ',
    );
    const individual = contractParams({ ...ctx, client: buyerFromContact(contact), quote: null, prepayment: null });
    expect((individual.client as Record<string, string>).name).toBe('Айгерим');
    expect(renderContract('{{quote.total}}|{{prepayment.amount}}', { ...ctx, quote: null, prepayment: null })).toBe('|');
  });
});

describe('ESF', () => {
  it('is required for company clients of a VAT-paying seller', () => {
    const company = buyerFromCompany('co1', normalizeCompany({ name: 'ТОО', bin: '940140001234', legalAddress: 'Астана' }), contact);
    expect(esfRequired(seller, company)).toBe(true);
    expect(esfRequired({ vatPayer: false }, company)).toBe(false);
    expect(esfRequired(seller, buyerFromContact(contact))).toBe(false);
  });

  it('builds one service line with included VAT', () => {
    const company = buyerFromCompany('co1', normalizeCompany({ name: 'ТОО «Ромашка»', bin: '940140001234', legalAddress: 'Астана' }), contact);
    const esf = buildEsfInvoice({
      actNumber: 'GL-A-2026-000001',
      actDate: '2026-10-21',
      eventDate: '2026-10-20',
      requestNumber: 'GL-B-2026-000001',
      amount: Money.tenge(1_160_000),
      vat: Money.tenge(160_000),
      vatRateBp: 1600,
      seller,
      buyer: company,
      contract: { number: 'GL-D-2026-000001', date: '2026-10-01' },
    });
    expect(esf.totals.withoutTax.amount).toBe(100_000_000);
    expect(esf.items).toHaveLength(1);
    expect(esf.items[0]).toMatchObject({ quantity: 1, vatRateBp: 1600 });
    expect(esf.customer).toMatchObject({ bin: '940140001234', name: 'ТОО «Ромашка»' });
    expect(esf.turnoverDate).toBe('2026-10-20');
  });
});
