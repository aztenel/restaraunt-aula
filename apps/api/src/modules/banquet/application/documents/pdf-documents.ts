import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { brandHeader, PDF_STYLES } from '../../../../shared/infrastructure/pdf/pdf-renderer';
import { Money } from '../../../../shared/kernel/money';
import { Locale, translate } from '../../../../shared/kernel/translatable';
import { formatDateRu } from '../../domain/dates';
import { amountInWordsRu, formatPercent, formatTenge } from '../../domain/money-format';
import { QuoteDiscount } from '../../domain/quote';
import { BuyerSnapshot, SellerSnapshot } from '../../domain/requisites';
import { QuoteLineRecord, QuoteRecord } from '../../infrastructure/quote.repository';

/**
 * PDF-документы банкета под брендом AULA: смета (на языке гостя), счёт на оплату, договор, акт
 * выполненных работ (на русском — документы для бухгалтерии заказчика). Чистые функции: данные -> описание pdfmake.
 */
const BRAND = 'AULA';

const QUOTE_TEXTS: Record<Locale, Record<string, string>> = {
  ru: {
    title: 'Смета банкета',
    version: 'версия',
    client: 'Заказчик',
    event: 'Мероприятие',
    date: 'Дата',
    guests: 'Гостей',
    place: 'Место',
    venue: 'Зал',
    no: '№',
    item: 'Наименование',
    unit: 'Ед.',
    qty: 'Кол-во',
    price: 'Цена',
    discount: 'Скидка',
    sum: 'Сумма',
    subtotal: 'Итого по позициям',
    discounts: 'Скидки',
    service: 'Обслуживание',
    total: 'Итого к оплате',
    vatIncluded: 'в т.ч. НДС',
    noVat: 'Без НДС',
    perGuest: 'На одного гостя',
    validUntil: 'Смета действительна до',
    manager: 'Ваш менеджер',
    notes: 'Примечания',
    seller: 'Исполнитель',
  },
  kk: {
    title: 'Банкет сметасы',
    version: 'нұсқа',
    client: 'Тапсырыс беруші',
    event: 'Іс-шара',
    date: 'Күні',
    guests: 'Қонақ саны',
    place: 'Орны',
    venue: 'Зал',
    no: '№',
    item: 'Атауы',
    unit: 'Өлш.',
    qty: 'Саны',
    price: 'Бағасы',
    discount: 'Жеңілдік',
    sum: 'Сомасы',
    subtotal: 'Позициялар бойынша барлығы',
    discounts: 'Жеңілдіктер',
    service: 'Қызмет көрсету',
    total: 'Төлеуге барлығы',
    vatIncluded: 'оның ішінде ҚҚС',
    noVat: 'ҚҚС-сыз',
    perGuest: 'Бір қонаққа',
    validUntil: 'Смета жарамды',
    manager: 'Сіздің менеджеріңіз',
    notes: 'Ескертпелер',
    seller: 'Орындаушы',
  },
  en: {
    title: 'Banquet quote',
    version: 'version',
    client: 'Client',
    event: 'Event',
    date: 'Date',
    guests: 'Guests',
    place: 'Place',
    venue: 'Hall',
    no: '#',
    item: 'Item',
    unit: 'Unit',
    qty: 'Qty',
    price: 'Price',
    discount: 'Discount',
    sum: 'Amount',
    subtotal: 'Items total',
    discounts: 'Discounts',
    service: 'Service charge',
    total: 'Total',
    vatIncluded: 'incl. VAT',
    noVat: 'No VAT',
    perGuest: 'Per guest',
    validUntil: 'Valid until',
    manager: 'Your manager',
    notes: 'Notes',
    seller: 'Contractor',
  },
};

function sellerLines(s: SellerSnapshot): string[] {
  return [s.name, `БИН ${s.bin}`, s.legalAddress, [s.phone, s.email].filter(Boolean).join(', ')].filter((l) => l.length > 0);
}

function discountText(d: QuoteDiscount, amount: Money): string {
  if (!d || amount.isZero()) return '';
  return d.type === 'percent' ? `${formatPercent(d.bp)}% (${formatTenge(amount)})` : formatTenge(amount);
}

function right(text: string, bold = false): TableCell {
  return { text, alignment: 'right', bold };
}

function totalsTable(rows: Array<[string, string, boolean?]>): Content {
  return {
    margin: [0, 8, 0, 0],
    columns: [
      { width: '*', text: '' },
      {
        width: 'auto',
        table: { body: rows.map(([label, value, bold]) => [{ text: label, bold: !!bold }, right(value, !!bold)]) },
        layout: 'noBorders',
      },
    ],
  };
}

export interface QuotePdfInput {
  locale: Locale;
  requestNumber: string;
  quote: QuoteRecord;
  client: { name: string; phone: string | null; email: string | null; company: string | null };
  event: { date: string; time: string | null; typeLabel: string; guests: number; place: string; venue: string | null };
  manager: { name: string; phone: string | null; email: string | null };
}

export function quotePdf(input: QuotePdfInput): TDocumentDefinitions {
  const t = QUOTE_TEXTS[input.locale];
  const q = input.quote;
  const lineRows: TableCell[][] = q.lines.map((l: QuoteLineRecord) => [
    String(l.position),
    translate(l.title, input.locale),
    l.unit,
    right(String(l.quantity)),
    right(formatTenge(l.unitPrice)),
    right(discountText(l.discount, l.discountAmount)),
    right(formatTenge(l.total)),
  ]);
  const totals: Array<[string, string, boolean?]> = [[t.subtotal!, formatTenge(q.totals.subtotal)]];
  if (q.totals.discount.isPositive()) totals.push([t.discounts!, `−${formatTenge(q.totals.discount)}`]);
  if (q.serviceChargeBp > 0) totals.push([`${t.service} ${formatPercent(q.serviceChargeBp)}%`, formatTenge(q.totals.service)]);
  totals.push([t.total!, formatTenge(q.totals.total), true]);
  totals.push(q.vat.payer ? [`${t.vatIncluded} ${formatPercent(q.vat.rateBp)}%`, formatTenge(q.totals.vat)] : [t.noVat!, '']);
  totals.push([`${t.perGuest} (${q.guests})`, formatTenge(q.totals.perGuest)]);
  const content: Content[] = [
    brandHeader({ brand: BRAND, subtitle: `${t.title} № ${input.requestNumber}`, lines: [`${t.version} ${q.version}`, ...sellerLines(q.seller)] }),
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: t.client!, style: 'h2' },
            input.client.company ?? input.client.name,
            ...(input.client.company ? [input.client.name] : []),
            [input.client.phone, input.client.email].filter(Boolean).join(', '),
          ],
        },
        {
          width: '*',
          stack: [
            { text: t.event!, style: 'h2' },
            input.event.typeLabel,
            `${t.date}: ${formatDateRu(input.event.date)}${input.event.time ? ` ${input.event.time}` : ''}`,
            `${t.guests}: ${input.event.guests}`,
            `${t.place}: ${input.event.place}`,
            ...(input.event.venue ? [`${t.venue}: ${input.event.venue}`] : []),
          ],
        },
      ],
      margin: [0, 0, 0, 12],
    },
    {
      table: {
        headerRows: 1,
        widths: [18, '*', 34, 36, 62, 70, 70],
        body: [
          [t.no, t.item, t.unit, t.qty, t.price, t.discount, t.sum].map((h) => ({ text: h!, style: 'tableHeader' })),
          ...lineRows,
        ],
      },
      layout: 'lightHorizontalLines',
      fontSize: 9,
    },
    totalsTable(totals),
  ];
  if (q.totals.overallDiscount.isPositive() && q.discount) {
    content.push({ text: `${t.discounts}: ${discountText(q.discount, q.totals.overallDiscount)}`, style: 'muted', margin: [0, 4, 0, 0] });
  }
  if (q.notes) content.push({ text: t.notes!, style: 'h2' }, { text: q.notes });
  if (q.validUntil) content.push({ text: `${t.validUntil}: ${formatDateRu(q.validUntil)}`, margin: [0, 12, 0, 0] });
  content.push({
    text: `${t.manager}: ${input.manager.name}${input.manager.phone ? `, ${input.manager.phone}` : ''}${input.manager.email ? `, ${input.manager.email}` : ''}`,
    margin: [0, 4, 0, 0],
  });
  return { info: { title: `${t.title} ${input.requestNumber} v${q.version}` }, content, styles: PDF_STYLES as unknown as TDocumentDefinitions['styles'] };
}

// ---------------------------------------------------------------- счёт на оплату

export interface InvoicePdfInput {
  number: string;
  issuedDate: string;
  dueDate: string;
  seller: SellerSnapshot;
  buyer: BuyerSnapshot;
  description: string;
  amount: Money;
  vat: Money;
  vatRateBp: number;
  contract: { number: string; date: string } | null;
}

function requisitesStack(title: string, lines: Array<string | null | undefined>): Content {
  return { stack: [{ text: title, bold: true }, ...lines.filter((l): l is string => !!l && l.trim().length > 0)], margin: [0, 0, 0, 8] };
}

export function invoicePdf(input: InvoicePdfInput): TDocumentDefinitions {
  const s = input.seller;
  const b = input.buyer;
  const content: Content[] = [
    brandHeader({ brand: BRAND, subtitle: 'Счёт на оплату', lines: sellerLines(s) }),
    {
      table: {
        widths: ['*', 'auto', 'auto'],
        body: [
          [{ text: 'Бенефициар', bold: true }, { text: 'ИИК', bold: true }, { text: 'Кбе', bold: true }],
          [`${s.name}\nБИН ${s.bin}`, s.iban, s.kbe],
          [{ text: 'Банк бенефициара', bold: true }, { text: 'БИК', bold: true }, { text: 'Код назначения платежа', bold: true }],
          [s.bankName, s.bik, '859'],
        ],
      },
      margin: [0, 0, 0, 12],
    },
    { text: `Счёт на оплату № ${input.number} от ${formatDateRu(input.issuedDate)}`, style: 'h1' },
    requisitesStack('Поставщик:', [`${s.name}, БИН ${s.bin}`, s.legalAddress, s.phone]),
    requisitesStack('Покупатель:', [
      b.bin ? `${b.name}, БИН ${b.bin}` : b.name,
      b.legalAddress,
      b.iban ? `ИИК ${b.iban}${b.bankName ? `, ${b.bankName}` : ''}${b.bik ? `, БИК ${b.bik}` : ''}` : null,
      [b.phone, b.email].filter(Boolean).join(', '),
    ]),
    ...(input.contract ? [{ text: `Договор: № ${input.contract.number} от ${formatDateRu(input.contract.date)}`, margin: [0, 0, 0, 8] } as Content] : []),
    {
      table: {
        headerRows: 1,
        widths: [18, '*', 40, 34, 80, 80],
        body: [
          ['№', 'Наименование', 'Кол-во', 'Ед.', 'Цена', 'Сумма'].map((h) => ({ text: h, style: 'tableHeader' })),
          ['1', input.description, right('1'), 'усл.', right(formatTenge(input.amount)), right(formatTenge(input.amount))],
        ],
      },
      layout: 'lightHorizontalLines',
    },
    totalsTable([
      ['Итого:', formatTenge(input.amount), true],
      input.vatRateBp > 0 ? [`в т.ч. НДС ${formatPercent(input.vatRateBp)}%:`, formatTenge(input.vat)] : ['Без НДС', ''],
    ]),
    { text: `Всего наименований 1, на сумму ${formatTenge(input.amount)}`, margin: [0, 8, 0, 0] },
    { text: `Всего к оплате: ${amountInWordsRu(input.amount)}`, bold: true },
    { text: `Оплатить до ${formatDateRu(input.dueDate)}.`, margin: [0, 8, 0, 0] },
    { text: `\n${s.directorPosition} ____________________ /${s.directorName}/`, margin: [0, 24, 0, 0] },
  ];
  return { info: { title: `Счёт ${input.number}` }, content, styles: PDF_STYLES as unknown as TDocumentDefinitions['styles'] };
}

// ---------------------------------------------------------------- договор

export interface ContractPdfInput {
  number: string;
  date: string;
  text: string;
  seller: SellerSnapshot;
  client: BuyerSnapshot;
}

export function contractPdf(input: ContractPdfInput): TDocumentDefinitions {
  const s = input.seller;
  const c = input.client;
  const paragraphs = input.text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ text: p, margin: [0, 0, 0, 6] as [number, number, number, number], alignment: 'justify' as const }));
  return {
    info: { title: `Договор ${input.number}` },
    content: [
      brandHeader({ brand: BRAND, subtitle: `Договор № ${input.number}`, lines: [`от ${formatDateRu(input.date)}`] }),
      ...paragraphs,
      {
        margin: [0, 16, 0, 0],
        columns: [
          requisitesStack('Исполнитель', [s.name, `БИН ${s.bin}`, s.legalAddress, `ИИК ${s.iban}`, `${s.bankName}, БИК ${s.bik}`, `Кбе ${s.kbe}`, `\n____________ /${s.directorName}/`]),
          requisitesStack('Заказчик', [
            c.name,
            c.bin ? `БИН ${c.bin}` : null,
            c.legalAddress,
            c.iban ? `ИИК ${c.iban}` : null,
            c.bankName ? `${c.bankName}${c.bik ? `, БИК ${c.bik}` : ''}` : null,
            c.kbe ? `Кбе ${c.kbe}` : null,
            c.phone,
            `\n____________ /${c.directorName ?? c.contactName ?? c.name}/`,
          ]),
        ],
      },
    ],
    styles: PDF_STYLES as unknown as TDocumentDefinitions['styles'],
  };
}

// ---------------------------------------------------------------- акт выполненных работ

export interface ActPdfInput {
  number: string;
  date: string;
  requestNumber: string;
  eventDate: string;
  seller: SellerSnapshot;
  buyer: BuyerSnapshot;
  lines: QuoteLineRecord[];
  quote: QuoteRecord;
  amount: Money;
  vat: Money;
  vatRateBp: number;
  contract: { number: string; date: string } | null;
}

export function actPdf(input: ActPdfInput): TDocumentDefinitions {
  const s = input.seller;
  const b = input.buyer;
  const q = input.quote;
  const rows: TableCell[][] = input.lines.map((l) => [
    String(l.position),
    translate(l.title, 'ru'),
    l.unit,
    right(String(l.quantity)),
    right(formatTenge(l.unitPrice)),
    right(formatTenge(l.total)),
  ]);
  const totals: Array<[string, string, boolean?]> = [['Итого по позициям:', formatTenge(q.totals.subtotal.subtract(q.totals.linesDiscount))]];
  if (q.totals.overallDiscount.isPositive()) totals.push(['Скидка:', `−${formatTenge(q.totals.overallDiscount)}`]);
  if (q.totals.service.isPositive()) totals.push([`Обслуживание ${formatPercent(q.serviceChargeBp)}%:`, formatTenge(q.totals.service)]);
  totals.push(['Всего:', formatTenge(input.amount), true]);
  totals.push(input.vatRateBp > 0 ? [`в т.ч. НДС ${formatPercent(input.vatRateBp)}%:`, formatTenge(input.vat)] : ['Без НДС', '']);
  return {
    info: { title: `Акт ${input.number}` },
    content: [
      brandHeader({ brand: BRAND, subtitle: 'Акт выполненных работ (оказанных услуг)', lines: sellerLines(s) }),
      { text: `Акт № ${input.number} от ${formatDateRu(input.date)}`, style: 'h1' },
      requisitesStack('Исполнитель:', [`${s.name}, БИН ${s.bin}`, s.legalAddress]),
      requisitesStack('Заказчик:', [b.bin ? `${b.name}, БИН ${b.bin}` : b.name, b.legalAddress]),
      ...(input.contract ? [{ text: `Договор: № ${input.contract.number} от ${formatDateRu(input.contract.date)}` } as Content] : []),
      {
        text: `Услуги по организации банкета по заявке № ${input.requestNumber}, дата оказания услуг: ${formatDateRu(input.eventDate)}.`,
        margin: [0, 4, 0, 8],
      },
      {
        table: {
          headerRows: 1,
          widths: [18, '*', 34, 40, 75, 80],
          body: [['№', 'Наименование', 'Ед.', 'Кол-во', 'Цена', 'Сумма'].map((h) => ({ text: h, style: 'tableHeader' })), ...rows],
        },
        layout: 'lightHorizontalLines',
        fontSize: 9,
      },
      totalsTable(totals),
      { text: `Всего оказано услуг на сумму: ${amountInWordsRu(input.amount)}`, bold: true, margin: [0, 8, 0, 0] },
      { text: 'Услуги оказаны в полном объёме и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет.', margin: [0, 8, 0, 0] },
      {
        margin: [0, 24, 0, 0],
        columns: [
          { text: `Исполнитель:\n${s.directorPosition} ____________ /${s.directorName}/\nМ.П.` },
          { text: `Заказчик:\n____________ /${b.directorName ?? b.contactName ?? b.name}/\nМ.П.` },
        ],
      },
    ],
    styles: PDF_STYLES as unknown as TDocumentDefinitions['styles'],
  };
}
