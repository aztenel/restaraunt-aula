import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { EsfInvoiceData, EsfParty } from '../../domain/esf';
import { formatDateRu } from '../../domain/dates';
import { toMajorString } from '../../domain/money-format';

/**
 * XML электронного счёта-фактуры, близкий к структуре ИС ЭСФ v2 (v2:invoice): продавец и покупатель (БИН),
 * дата оборота, товары/услуги, НДС. Общий для режима «вручную» (черновик для бухгалтера) и отправки через API.
 */
export const EsfXmlOptionsSchema = z.object({
  /** ФИО оператора (бухгалтера), выписывающего ЭСФ. */
  operatorFullname: z.string().trim().max(200).optional(),
  /** Код единицы измерения (классификатор) для услуг. */
  unitCode: z.string().trim().max(10).default('5114'),
  unitNomenclature: z.string().trim().max(20).default('усл.'),
  /** Признак происхождения: 6 — работы, услуги. */
  truOriginCode: z.coerce.number().int().min(1).max(6).default(6),
  /** Наименование услуги в ЭСФ (по умолчанию — «Услуги по организации банкета (заявка № …)»). */
  productDescription: z.string().trim().max(500).optional(),
});
export type EsfXmlOptions = z.infer<typeof EsfXmlOptionsSchema>;

export const ESF_XML_FIELDS = [
  { name: 'operatorFullname', label: 'ФИО оператора ЭСФ (бухгалтер)', type: 'string' as const },
  { name: 'unitCode', label: 'Код единицы измерения услуги', type: 'string' as const, help: 'По умолчанию 5114 (услуга)' },
  { name: 'unitNomenclature', label: 'Единица измерения', type: 'string' as const, help: 'По умолчанию «усл.»' },
  { name: 'truOriginCode', label: 'Признак происхождения ТРУ', type: 'number' as const, help: '6 — работы, услуги' },
  { name: 'productDescription', label: 'Наименование услуги', type: 'string' as const },
];

/** Ставка НДС: 1600 bp -> «16», 1250 -> «12.5». */
function rate(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

function party(p: EsfParty, withBank: boolean): Record<string, unknown> {
  const node: Record<string, unknown> = { address: p.address, name: p.name, tin: p.bin };
  if (withBank) {
    Object.assign(node, {
      bank: p.bank ?? undefined,
      bik: p.bik ?? undefined,
      certificateNum: p.vatCertificate ?? undefined,
      iik: p.iik ?? undefined,
      kbe: p.kbe ?? undefined,
    });
  }
  return Object.fromEntries(Object.entries(node).filter(([, v]) => v !== undefined && v !== null && v !== '').sort(([a], [b]) => a.localeCompare(b)));
}

export function buildEsfXml(data: EsfInvoiceData, options: EsfXmlOptions): string {
  const products = data.items.map((item) => ({
    description: options.productDescription || item.description,
    ndsAmount: toMajorString(item.vat),
    ndsRate: rate(item.vatRateBp),
    priceWithTax: toMajorString(item.priceWithTax),
    priceWithoutTax: toMajorString(item.priceWithoutTax),
    quantity: String(item.quantity),
    truOriginCode: String(options.truOriginCode),
    turnoverSize: toMajorString(item.priceWithoutTax),
    unitCode: options.unitCode,
    unitNomenclature: options.unitNomenclature,
    unitPrice: toMajorString(item.unitPriceWithoutTax),
  }));
  const invoice: Record<string, unknown> = {
    '@_xmlns:a': 'abstractInvoice.esf',
    '@_xmlns:v2': 'v2.esf',
    date: formatDateRu(data.date),
    invoiceType: 'ORDINARY_INVOICE',
    num: data.number,
    ...(options.operatorFullname ? { operatorFullname: options.operatorFullname } : {}),
    turnoverDate: formatDateRu(data.turnoverDate),
    customers: { customer: [party(data.customer, false)] },
    ...(data.contract
      ? { deliveryTerm: { contractDate: formatDateRu(data.contract.date), contractNum: data.contract.number, hasContract: 'true' } }
      : { deliveryTerm: { hasContract: 'false' } }),
    productSet: {
      currencyCode: data.totals.withTax.currency,
      products: { product: products },
      totalExciseAmount: '0.00',
      totalNdsAmount: toMajorString(data.totals.vat),
      totalPriceWithTax: toMajorString(data.totals.withTax),
      totalPriceWithoutTax: toMajorString(data.totals.withoutTax),
      totalTurnoverSize: toMajorString(data.totals.withoutTax),
    },
    sellers: { seller: [party(data.seller, true)] },
  };
  const builder = new XMLBuilder({ ignoreAttributes: false, format: true, suppressEmptyNode: true, attributeNamePrefix: '@_' });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build({ 'v2:invoice': invoice })}`;
}

/** Разбор XML-ответов (SOAP): без префиксов пространств имён, значения строками. */
export function parseXml(text: string): Record<string, unknown> {
  const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false });
  return parser.parse(text) as Record<string, unknown>;
}

/** Поиск первого узла с именем в дереве разобранного XML. */
export function findNode(tree: unknown, name: string): unknown {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) {
    for (const item of tree) {
      const found = findNode(item, name);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const obj = tree as Record<string, unknown>;
  if (name in obj) return obj[name];
  for (const value of Object.values(obj)) {
    const found = findNode(value, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
