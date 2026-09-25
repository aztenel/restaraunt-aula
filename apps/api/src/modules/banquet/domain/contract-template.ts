import { ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { renderTemplate, templateVariables } from '../../../shared/kernel/template';
import { formatDateRu } from './dates';
import { amountInWordsRu, formatPercent, formatTenge } from './money-format';
import { BuyerSnapshot, SellerSnapshot } from './requisites';

/**
 * Договор по шаблону: текст с подстановками {{seller.name}}, {{client.bin}}, {{event.date}}, {{quote.total}} …
 * Шаблоны хранятся в БД и редактируются в админке; здесь — перечень допустимых подстановок и их значения.
 */
export const CONTRACT_PLACEHOLDERS: Readonly<Record<string, string>> = {
  'contract.number': 'Номер договора',
  'contract.date': 'Дата договора (дд.мм.гггг)',
  'request.number': 'Номер банкетной заявки',
  'seller.name': 'Исполнитель: полное наименование',
  'seller.shortName': 'Исполнитель: краткое наименование',
  'seller.bin': 'Исполнитель: БИН',
  'seller.legalAddress': 'Исполнитель: юридический адрес',
  'seller.directorName': 'Исполнитель: ФИО руководителя',
  'seller.directorPosition': 'Исполнитель: должность руководителя',
  'seller.actingBasis': 'Исполнитель: действует на основании',
  'seller.bankName': 'Исполнитель: банк',
  'seller.iban': 'Исполнитель: ИИК (IBAN)',
  'seller.bik': 'Исполнитель: БИК',
  'seller.kbe': 'Исполнитель: КБе',
  'seller.phone': 'Исполнитель: телефон',
  'seller.email': 'Исполнитель: email',
  'seller.vat': 'НДС: «в т.ч. НДС 16%» или «без НДС»',
  'client.name': 'Заказчик: наименование или ФИО',
  'client.bin': 'Заказчик: БИН',
  'client.legalAddress': 'Заказчик: юридический адрес',
  'client.directorName': 'Заказчик: ФИО руководителя',
  'client.directorPosition': 'Заказчик: должность руководителя',
  'client.actingBasis': 'Заказчик: действует на основании',
  'client.bankName': 'Заказчик: банк',
  'client.iban': 'Заказчик: ИИК (IBAN)',
  'client.bik': 'Заказчик: БИК',
  'client.kbe': 'Заказчик: КБе',
  'client.contactName': 'Заказчик: контактное лицо',
  'client.phone': 'Заказчик: телефон',
  'client.email': 'Заказчик: email',
  'event.date': 'Дата мероприятия (дд.мм.гггг)',
  'event.time': 'Время начала',
  'event.type': 'Тип мероприятия',
  'event.guests': 'Количество гостей',
  'event.place': 'Место проведения (филиал или адрес выезда)',
  'event.venue': 'Зал',
  'quote.version': 'Версия сметы',
  'quote.total': 'Итог сметы',
  'quote.totalWords': 'Итог сметы прописью',
  'quote.vat': 'НДС в итоге сметы',
  'quote.perGuest': 'Стоимость на гостя',
  'prepayment.amount': 'Сумма предоплаты',
  'prepayment.amountWords': 'Сумма предоплаты прописью',
  'manager.name': 'Ответственный менеджер',
  'manager.phone': 'Телефон менеджера',
};

export const MIN_TEMPLATE_LENGTH = 20;
export const MAX_TEMPLATE_LENGTH = 100_000;

/** Проверка шаблона при сохранении: неизвестные подстановки — ошибка (опечатка останется пустым местом в договоре). */
export function validateTemplateBody(body: string): string {
  const text = body.replace(/\r\n/g, '\n').trim();
  if (text.length < MIN_TEMPLATE_LENGTH || text.length > MAX_TEMPLATE_LENGTH) {
    throw new ValidationError('banquet_template.invalid_length', `Template must be ${MIN_TEMPLATE_LENGTH}..${MAX_TEMPLATE_LENGTH} characters`);
  }
  const unknown = [...new Set(templateVariables(text).filter((v) => !(v in CONTRACT_PLACEHOLDERS)))];
  if (unknown.length > 0) {
    throw new ValidationError('banquet_template.unknown_placeholders', 'Template has unknown placeholders', { unknown });
  }
  return text;
}

export interface ContractContext {
  contract: { number: string; date: string };
  requestNumber: string;
  seller: SellerSnapshot;
  client: BuyerSnapshot;
  event: { date: string; time: string | null; typeLabel: string; guests: number; place: string; venue: string | null };
  quote: { version: number; total: Money; vat: Money; perGuest: Money } | null;
  prepayment: Money | null;
  manager: { name: string; phone: string | null };
}

/** Значения подстановок (строки, уже отформатированные). */
export function contractParams(ctx: ContractContext): Record<string, unknown> {
  const s = ctx.seller;
  const c = ctx.client;
  return {
    contract: { number: ctx.contract.number, date: formatDateRu(ctx.contract.date) },
    request: { number: ctx.requestNumber },
    seller: {
      name: s.name,
      shortName: s.shortName,
      bin: s.bin,
      legalAddress: s.legalAddress,
      directorName: s.directorName,
      directorPosition: s.directorPosition,
      actingBasis: s.actingBasis,
      bankName: s.bankName,
      iban: s.iban,
      bik: s.bik,
      kbe: s.kbe,
      phone: s.phone ?? '',
      email: s.email ?? '',
      vat: s.vatPayer ? `в т.ч. НДС ${formatPercent(s.vatRateBp)}%` : 'без НДС',
    },
    client: {
      name: c.name,
      bin: c.bin ?? '',
      legalAddress: c.legalAddress ?? '',
      directorName: c.directorName ?? '',
      directorPosition: c.directorPosition ?? '',
      actingBasis: c.actingBasis ?? '',
      bankName: c.bankName ?? '',
      iban: c.iban ?? '',
      bik: c.bik ?? '',
      kbe: c.kbe ?? '',
      contactName: c.contactName ?? c.name,
      phone: c.phone ?? '',
      email: c.email ?? '',
    },
    event: {
      date: formatDateRu(ctx.event.date),
      time: ctx.event.time ?? '',
      type: ctx.event.typeLabel,
      guests: String(ctx.event.guests),
      place: ctx.event.place,
      venue: ctx.event.venue ?? '',
    },
    quote: ctx.quote
      ? {
          version: String(ctx.quote.version),
          total: formatTenge(ctx.quote.total),
          totalWords: amountInWordsRu(ctx.quote.total),
          vat: formatTenge(ctx.quote.vat),
          perGuest: formatTenge(ctx.quote.perGuest),
        }
      : {},
    prepayment: ctx.prepayment ? { amount: formatTenge(ctx.prepayment), amountWords: amountInWordsRu(ctx.prepayment) } : {},
    manager: { name: ctx.manager.name, phone: ctx.manager.phone ?? '' },
  };
}

export function renderContract(body: string, ctx: ContractContext): string {
  return renderTemplate(body, contractParams(ctx));
}
