import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { brandHeader, PDF_STYLES } from '../../../../shared/infrastructure/pdf/pdf-renderer';
import { Money } from '../../../../shared/kernel/money';
import { Locale, Translatable, translate } from '../../../../shared/kernel/translatable';
import { formatTenge } from '../../domain/money-format';
import { CertificateKind } from '../../public';
import { formatExpiry } from './certificate-views';

/** Тексты PDF на трёх языках (kk/ru — основные, en — опционально). */
const TEXTS: Record<Locale, Record<string, string>> = {
  ru: {
    title: 'Подарочный сертификат',
    nominal: 'Номинал',
    set: 'Набор',
    code: 'Код сертификата',
    validUntil: 'Действителен до',
    for: 'Для',
    message: 'Пожелание',
    conditions: 'Условия',
    branches: 'Рестораны',
    c1: 'Сертификат принимается во всех ресторанах AULA и при заказе на сайте.',
    c2amount: 'Сертификат на сумму можно использовать частями до окончания срока действия.',
    c2set: 'Сертификат на набор погашается целиком за один визит.',
    c3: 'Сертификат не обменивается на деньги, остаток не возвращается.',
    c4: 'Покажите код или QR-код сотруднику ресторана либо введите код при оформлении заказа.',
    c5: 'Не передавайте код третьим лицам: воспользоваться сертификатом может любой, кто знает код.',
  },
  kk: {
    title: 'Сыйлық сертификаты',
    nominal: 'Номиналы',
    set: 'Жиынтық',
    code: 'Сертификат коды',
    validUntil: 'Жарамдылық мерзімі',
    for: 'Кімге',
    message: 'Тілек',
    conditions: 'Шарттар',
    branches: 'Мейрамханалар',
    c1: 'Сертификат барлық AULA мейрамханаларында және сайтта тапсырыс бергенде қабылданады.',
    c2amount: 'Сомаға берілген сертификатты мерзімі біткенге дейін бөліп пайдалануға болады.',
    c2set: 'Жиынтыққа берілген сертификат бір келгенде толығымен өтеледі.',
    c3: 'Сертификат ақшаға айырбасталмайды, қалдығы қайтарылмайды.',
    c4: 'Кодты немесе QR-кодты мейрамхана қызметкеріне көрсетіңіз не тапсырыс рәсімдегенде кодты енгізіңіз.',
    c5: 'Кодты үшінші тұлғаларға бермеңіз: кодты білетін кез келген адам сертификатты пайдалана алады.',
  },
  en: {
    title: 'Gift certificate',
    nominal: 'Value',
    set: 'Set',
    code: 'Certificate code',
    validUntil: 'Valid until',
    for: 'For',
    message: 'Message',
    conditions: 'Terms',
    branches: 'Restaurants',
    c1: 'Accepted in all AULA restaurants and for orders on the website.',
    c2amount: 'A value certificate can be used in parts until it expires.',
    c2set: 'A set certificate is redeemed in full during one visit.',
    c3: 'The certificate cannot be exchanged for cash; the remaining balance is not refunded.',
    c4: 'Show the code or QR code to the restaurant staff or enter the code at checkout.',
    c5: 'Do not share the code: anyone who knows it can use the certificate.',
  },
};

export interface CertificateDocumentInput {
  /** Полный код — показывается один раз: в этом PDF и в сообщении. */
  code: string;
  kind: CertificateKind;
  name: Translatable;
  setDescription: Translatable | null;
  nominal: Money;
  expiresAt: Date;
  recipientName: string | null;
  message: string | null;
  locale: Locale;
  color: string;
  seller: { name: string; bin: string } | null;
  branches: Array<{ name: Translatable; address: Translatable }>;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Макет PDF сертификата: бренд, номинал/набор, код, QR-код, срок, пожелание, условия. */
export function certificateDocument(input: CertificateDocumentInput): TDocumentDefinitions {
  const t = TEXTS[input.locale] ?? TEXTS.ru;
  const color = HEX_RE.test(input.color) ? input.color : '#7a4b2a';
  const valueBlock: Content[] =
    input.kind === 'set'
      ? [
          { text: t.set!, style: 'muted' },
          { text: translate(input.name, input.locale), fontSize: 20, bold: true, color },
          ...(input.setDescription ? [{ text: translate(input.setDescription, input.locale), margin: [0, 4, 0, 0] } as Content] : []),
        ]
      : [
          { text: t.nominal!, style: 'muted' },
          { text: formatTenge(input.nominal), fontSize: 28, bold: true, color },
          { text: translate(input.name, input.locale), margin: [0, 4, 0, 0] },
        ];
  const conditions = [t.c1!, input.kind === 'set' ? t.c2set! : t.c2amount!, t.c3!, t.c4!, t.c5!];
  return {
    info: { title: `AULA — ${t.title}`, author: 'AULA' },
    content: [
      brandHeader({
        brand: 'AULA',
        subtitle: t.title,
        lines: input.seller ? [input.seller.name, `БИН ${input.seller.bin}`] : [],
      }),
      {
        canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 6, color }],
        margin: [0, 0, 0, 16],
      },
      {
        columns: [
          {
            width: '*',
            stack: [
              ...valueBlock,
              ...(input.recipientName ? [{ text: `${t.for}: ${input.recipientName}`, margin: [0, 12, 0, 0], bold: true } as Content] : []),
              { text: t.code!, style: 'muted', margin: [0, 16, 0, 2] },
              { text: input.code, fontSize: 22, bold: true, characterSpacing: 2 },
              { text: `${t.validUntil}: ${formatExpiry(input.expiresAt)}`, margin: [0, 10, 0, 0] },
            ],
          },
          { width: 140, stack: [{ qr: input.code, fit: 130, foreground: '#000000', alignment: 'right' } as Content] },
        ],
      },
      ...(input.message
        ? [
            { text: t.message!, style: 'h2', color } as Content,
            { text: `«${input.message}»`, italics: true, margin: [0, 0, 0, 8] } as Content,
          ]
        : []),
      { text: t.conditions!, style: 'h2', color },
      { ul: conditions, fontSize: 9 },
      ...(input.branches.length
        ? [
            { text: t.branches!, style: 'h2', color } as Content,
            {
              ul: input.branches.map((b) => `${translate(b.name, input.locale)} — ${translate(b.address, input.locale)}`),
              fontSize: 9,
            } as Content,
          ]
        : []),
    ],
    styles: PDF_STYLES as unknown as TDocumentDefinitions['styles'],
  };
}
