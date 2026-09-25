import { Money } from '../../../shared/kernel/money';
import { BuyerSnapshot, SellerSnapshot } from './requisites';

/**
 * ЭСФ (электронный счёт-фактура, ИС ЭСФ) — по акту для юрлиц, если продавец — плательщик НДС (этап 3).
 * Интерфейс EsfGateway — здесь, реализации — в infrastructure/adapters (режим «вручную» по умолчанию:
 * черновик XML для бухгалтера; отправка через API ИС ЭСФ с подписью ЭЦП).
 */
export const EsfStatus = {
  /** ЭСФ не нужен: физлицо или продавец не плательщик НДС. */
  NotRequired: 'not_required',
  /** Задача формирования/отправки поставлена в очередь. */
  Pending: 'pending',
  /** Черновик XML сформирован и сохранён — бухгалтер загружает его в ИС ЭСФ. */
  DraftReady: 'draft_ready',
  /** Отправлен в ИС ЭСФ, регистрационный номер ещё не получен. */
  Sent: 'sent',
  Registered: 'registered',
  Failed: 'failed',
} as const;
export type EsfStatus = (typeof EsfStatus)[keyof typeof EsfStatus];

export const ESF_STATUSES = Object.values(EsfStatus) as EsfStatus[];

export interface EsfParty {
  bin: string;
  name: string;
  address: string;
  bank: string | null;
  iik: string | null;
  bik: string | null;
  kbe: string | null;
  vatCertificate: string | null;
}

export interface EsfItem {
  description: string;
  quantity: number;
  unitPriceWithoutTax: Money;
  priceWithoutTax: Money;
  vatRateBp: number;
  vat: Money;
  priceWithTax: Money;
}

export interface EsfInvoiceData {
  /** Номер ЭСФ у продавца (номер акта). */
  number: string;
  /** Дата выписки (YYYY-MM-DD). */
  date: string;
  /** Дата совершения оборота — дата мероприятия. */
  turnoverDate: string;
  seller: EsfParty;
  customer: EsfParty;
  contract: { number: string; date: string } | null;
  items: EsfItem[];
  totals: { withoutTax: Money; vat: Money; withTax: Money };
}

export interface EsfActSource {
  actNumber: string;
  actDate: string;
  eventDate: string;
  requestNumber: string;
  amount: Money;
  vat: Money;
  vatRateBp: number;
  seller: SellerSnapshot;
  buyer: BuyerSnapshot;
  contract: { number: string; date: string } | null;
}

/** ЭСФ нужен для юрлица-заказчика, если продавец — плательщик НДС. */
export function esfRequired(seller: Pick<SellerSnapshot, 'vatPayer'>, buyer: Pick<BuyerSnapshot, 'type' | 'bin'>): boolean {
  return seller.vatPayer && buyer.type === 'company' && !!buyer.bin;
}

/** Данные ЭСФ по акту: одна строка «услуги по организации банкета», НДС включён в сумму акта. */
export function buildEsfInvoice(src: EsfActSource): EsfInvoiceData {
  const withoutTax = src.amount.subtract(src.vat);
  const item: EsfItem = {
    description: `Услуги по организации банкета (заявка № ${src.requestNumber})`,
    quantity: 1,
    unitPriceWithoutTax: withoutTax,
    priceWithoutTax: withoutTax,
    vatRateBp: src.vatRateBp,
    vat: src.vat,
    priceWithTax: src.amount,
  };
  return {
    number: src.actNumber,
    date: src.actDate,
    turnoverDate: src.eventDate,
    seller: {
      bin: src.seller.bin,
      name: src.seller.name,
      address: src.seller.legalAddress,
      bank: src.seller.bankName,
      iik: src.seller.iban,
      bik: src.seller.bik,
      kbe: src.seller.kbe,
      vatCertificate: src.seller.vatCertificate,
    },
    customer: {
      bin: src.buyer.bin ?? '',
      name: src.buyer.name,
      address: src.buyer.legalAddress ?? '',
      bank: src.buyer.bankName,
      iik: src.buyer.iban,
      bik: src.buyer.bik,
      kbe: src.buyer.kbe,
      vatCertificate: null,
    },
    contract: src.contract,
    items: [item],
    totals: { withoutTax, vat: src.vat, withTax: src.amount },
  };
}

export type EsfSubmitResult =
  /** Черновик XML (загружает бухгалтер вручную). */
  | { outcome: 'draft'; xml: string }
  /** Отправлен в ИС ЭСФ: идентификатор и (если уже есть) регистрационный номер. */
  | { outcome: 'submitted'; xml: string; esfId: string; registrationNumber: string | null };

export interface EsfStatusResult {
  status: 'sent' | 'registered' | 'failed';
  registrationNumber: string | null;
  error: string | null;
}

/**
 * Шлюз ЭСФ. submit и checkStatus ходят во внешнюю систему (для режима API) и вызываются только
 * из фоновых задач. Ошибки внешней системы — ExternalServiceError(retryable).
 */
export abstract class EsfGateway {
  /** Имя провайдера (ключ настроек banquet.esf_<provider>). */
  abstract readonly provider: string;
  /** Адаптер включён в настройках. Адаптер по умолчанию (ручной режим) включён всегда. */
  abstract isEnabled(): Promise<boolean>;
  abstract submit(invoice: EsfInvoiceData, ctx: { correlationId: string }): Promise<EsfSubmitResult>;

  /** Состояние отправленного ЭСФ. По умолчанию — без изменений (ручной режим). */
  async checkStatus(_esfId: string, _ctx: { correlationId: string }): Promise<EsfStatusResult> {
    return { status: 'sent', registrationNumber: null, error: null };
  }
}
