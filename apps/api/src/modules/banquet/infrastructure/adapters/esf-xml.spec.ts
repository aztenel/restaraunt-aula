import { describe, expect, it } from 'vitest';
import { Money } from '../../../../shared/kernel/money';
import { EsfInvoiceData } from '../../domain/esf';
import { buildEsfXml, EsfXmlOptionsSchema, findNode, parseXml } from './esf-xml';

const party = { bin: '123456789012', name: 'ТОО «Express kitchen» & Co', address: 'Астана', bank: 'АО «Банк»', iik: 'KZ000000000000000000', bik: 'BANKKZKA', kbe: '17', vatCertificate: null };

function invoice(overrides: Partial<EsfInvoiceData> = {}): EsfInvoiceData {
  const withTax = Money.of(112_500);
  const vat = Money.of(12_500);
  return {
    number: 'GL-A-2026-000001',
    date: '2026-11-15',
    turnoverDate: '2026-11-14',
    seller: party,
    customer: { ...party, bin: '940140001234', name: 'ТОО «Ромашка»', bank: null, iik: null, bik: null, kbe: null },
    contract: null,
    items: [
      { description: 'Услуги', quantity: 1, unitPriceWithoutTax: withTax.subtract(vat), priceWithoutTax: withTax.subtract(vat), vatRateBp: 1250, vat, priceWithTax: withTax },
    ],
    totals: { withoutTax: withTax.subtract(vat), vat, withTax },
    ...overrides,
  };
}

describe('ESF XML', () => {
  it('builds an IS ESF v2-like invoice with escaped values and defaults', () => {
    const xml = buildEsfXml(invoice(), EsfXmlOptionsSchema.parse({}));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<v2:invoice xmlns:a="abstractInvoice.esf" xmlns:v2="v2.esf">');
    expect(xml).toContain('<name>ТОО «Express kitchen» &amp; Co</name>');
    expect(xml).toContain('<ndsRate>12.5</ndsRate>');
    expect(xml).toContain('<priceWithoutTax>1000.00</priceWithoutTax>');
    expect(xml).toContain('<unitCode>5114</unitCode>');
    expect(xml).toContain('<truOriginCode>6</truOriginCode>');
    expect(xml).toContain('<hasContract>false</hasContract>');
    expect(xml).not.toContain('operatorFullname');
    const tree = parseXml(xml);
    expect(findNode(findNode(tree, 'customer'), 'tin')).toBe('940140001234');
    expect(findNode(findNode(tree, 'seller'), 'kbe')).toBe('17');
    expect(findNode(tree, 'totalPriceWithTax')).toBe('1125.00');
  });

  it('includes contract and overrides from settings', () => {
    const xml = buildEsfXml(
      invoice({ contract: { number: 'GL-D-2026-000007', date: '2026-10-01' } }),
      EsfXmlOptionsSchema.parse({ operatorFullname: 'Бухгалтер', productDescription: 'Банкетное обслуживание', unitCode: '796' }),
    );
    expect(xml).toContain('<contractNum>GL-D-2026-000007</contractNum>');
    expect(xml).toContain('<contractDate>01.10.2026</contractDate>');
    expect(xml).toContain('<operatorFullname>Бухгалтер</operatorFullname>');
    expect(xml).toContain('<description>Банкетное обслуживание</description>');
    expect(xml).toContain('<unitCode>796</unitCode>');
  });
});
