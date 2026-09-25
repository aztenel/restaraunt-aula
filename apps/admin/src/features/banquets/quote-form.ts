/**
 * Конструктор сметы: форма ⇄ API. Никаких расчётов сумм: итоги, скидки строк, обслуживание и НДС
 * считает сервер при сохранении версии. Здесь — только перевод ввода в формат API без плавающей точки:
 *   проценты строкой («12,5») → базисные пункты (1250), суммы — целые тиыны { amount, currency }.
 * Позиции меню уходят как dishId + количество: цену и название сервер берёт из снимка прошлой версии
 * или из текущего меню филиала (показанная цена — справочно).
 */
import { formatFixed2ForInput, parseFixed2, type Money, type Translatable } from '@aula/api-client';
import {
  CUSTOM_LINE_KINDS,
  moneyInput,
  type CustomLineKind,
  type DiscountInput,
  type DishOption,
  type Quote,
  type QuoteDiscount,
  type QuoteLineInput,
  type QuoteLineKind,
  type SaveQuoteInput,
} from './types';

export const MAX_QUOTE_LINES = 300;
export const MAX_LINE_QUANTITY = 100_000;
/** Процент обслуживания — не больше 50% (5000 bp). */
export const MAX_SERVICE_CHARGE_BP = 5000;
export const MAX_PERCENT_BP = 10_000;
export const MAX_UNIT_LENGTH = 20;
export const MAX_NOTES_LENGTH = 4000;
export const DEFAULT_MENU_UNIT = 'порц.';

export type DiscountMode = 'none' | 'percent' | 'amount';

export interface DiscountFormValue {
  mode: DiscountMode;
  /** Процент строкой («10», «12,5»). */
  percent: string;
  /** Сумма в тиынах. */
  amount: number | null;
}

export interface QuoteLineForm {
  /** Ключ строки в интерфейсе. */
  key: string;
  kind: QuoteLineKind;
  /** Позиция меню. */
  dishId: string | null;
  /** Название блюда и цена для показа: снимок прошлой версии или цена филиала сейчас. */
  dishName: Translatable | null;
  shownPrice: Money | null;
  priceSource: 'snapshot' | 'menu' | null;
  availability: string | null;
  /** Произвольная позиция. */
  title: Translatable;
  unit: string;
  quantity: number | null;
  /** Цена за единицу произвольной позиции, тиыны. */
  unitPrice: number | null;
  discount: DiscountFormValue;
}

export interface QuoteFormValues {
  lines: QuoteLineForm[];
  discount: DiscountFormValue;
  /** Процент за обслуживание строкой; пусто — 0. */
  serviceCharge: string;
  guests: number | null;
  /** YYYY-MM-DD; пусто — по умолчанию сервера (14 дней). */
  validUntil: string | null;
  notes: string;
  refreshMenuPrices: boolean;
}

export type QuoteFormIssueCode =
  | 'noLines'
  | 'tooManyLines'
  | 'dishRequired'
  | 'titleRequired'
  | 'unitRequired'
  | 'unitTooLong'
  | 'priceRequired'
  | 'quantityInvalid'
  | 'discountPercentInvalid'
  | 'discountAmountRequired'
  | 'serviceChargeInvalid'
  | 'guestsInvalid'
  | 'notesTooLong';

export interface QuoteFormIssue {
  code: QuoteFormIssueCode;
  /** Номер строки (с 1) для ошибок строки. */
  line?: number;
  field: 'lines' | 'dish' | 'title' | 'unit' | 'unitPrice' | 'quantity' | 'discount' | 'serviceCharge' | 'guests' | 'notes';
}

export type SaveQuoteResult = { ok: true; input: SaveQuoteInput } | { ok: false; issues: QuoteFormIssue[] };

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `line-${Date.now().toString(36)}-${keySeq}`;
}

export const NO_DISCOUNT: DiscountFormValue = { mode: 'none', percent: '', amount: null };

// ---------------------------------------------------------------- проценты

/** Процент строкой → базисные пункты без плавающей точки: «12,5» → 1250, «100» → 10000. */
export function percentTextToBp(text: string, max = MAX_PERCENT_BP): { ok: true; value: number } | { ok: false } {
  const parsed = parseFixed2(text, { max });
  return parsed.ok ? { ok: true, value: parsed.value } : { ok: false };
}

/** Базисные пункты → строка для поля ввода: 1250 → «12,5», 1000 → «10». */
export function bpToPercentInput(bp: number | null | undefined, locale = 'ru'): string {
  if (bp === null || bp === undefined) return '';
  const text = formatFixed2ForInput(bp, locale);
  return text.replace(/([.,]\d)0$/, '$1');
}

// ---------------------------------------------------------------- скидки

export function discountFromApi(discount: QuoteDiscount | null | undefined, locale = 'ru'): DiscountFormValue {
  if (!discount) return { ...NO_DISCOUNT };
  if (discount.type === 'percent') return { mode: 'percent', percent: bpToPercentInput(discount.bp ?? 0, locale), amount: null };
  return { mode: 'amount', percent: '', amount: discount.amount?.amount ?? null };
}

type DiscountResult = { ok: true; value: DiscountInput | undefined } | { ok: false; code: 'discountPercentInvalid' | 'discountAmountRequired' };

export function discountToApi(value: DiscountFormValue): DiscountResult {
  if (value.mode === 'none') return { ok: true, value: undefined };
  if (value.mode === 'percent') {
    const bp = percentTextToBp(value.percent);
    if (!bp.ok) return { ok: false, code: 'discountPercentInvalid' };
    return { ok: true, value: bp.value === 0 ? undefined : { type: 'percent', bp: bp.value } };
  }
  if (value.amount === null || !Number.isSafeInteger(value.amount) || value.amount < 0) return { ok: false, code: 'discountAmountRequired' };
  return { ok: true, value: value.amount === 0 ? undefined : { type: 'amount', amount: moneyInput(value.amount) } };
}

// ---------------------------------------------------------------- строки

export function newMenuLine(dish: DishOption, quantity: number | null = null): QuoteLineForm {
  return {
    key: nextKey(),
    kind: 'menu',
    dishId: dish.dishId,
    dishName: dish.name,
    shownPrice: dish.price,
    priceSource: 'menu',
    availability: dish.availability,
    title: dish.name,
    unit: DEFAULT_MENU_UNIT,
    quantity,
    unitPrice: null,
    discount: { ...NO_DISCOUNT },
  };
}

export function newCustomLine(kind: CustomLineKind, unit = ''): QuoteLineForm {
  return {
    key: nextKey(),
    kind,
    dishId: null,
    dishName: null,
    shownPrice: null,
    priceSource: null,
    availability: null,
    title: {},
    unit,
    quantity: 1,
    unitPrice: null,
    discount: { ...NO_DISCOUNT },
  };
}

export function isCustomKind(kind: QuoteLineKind): kind is CustomLineKind {
  return (CUSTOM_LINE_KINDS as readonly string[]).includes(kind);
}

/** Пустая форма первой сметы: гостей — из заявки. */
export function emptyQuoteForm(guests: number | null): QuoteFormValues {
  return { lines: [], discount: { ...NO_DISCOUNT }, serviceCharge: '', guests, validUntil: null, notes: '', refreshMenuPrices: false };
}

/**
 * Форма новой версии на основе сохранённой версии (прошлые версии неизменяемы: правки — это новая версия).
 * Позиции меню несут снимок цены прошлой версии; срок действия — заново (по умолчанию сервера).
 */
export function quoteToForm(quote: Quote, locale = 'ru'): QuoteFormValues {
  return {
    lines: [...quote.lines]
      .sort((a, b) => a.position - b.position)
      .map((line) => ({
        key: nextKey(),
        kind: line.kind,
        dishId: line.kind === 'menu' ? line.dishId : null,
        dishName: line.kind === 'menu' ? line.title : null,
        shownPrice: line.kind === 'menu' ? line.unitPrice : null,
        priceSource: line.kind === 'menu' ? 'snapshot' : null,
        availability: null,
        title: line.title,
        unit: line.unit,
        quantity: line.quantity,
        unitPrice: line.kind === 'menu' ? null : line.unitPrice.amount,
        discount: discountFromApi(line.discount, locale),
      })),
    discount: discountFromApi(quote.discount, locale),
    serviceCharge: quote.serviceChargeBp > 0 ? bpToPercentInput(quote.serviceChargeBp, locale) : '',
    guests: quote.guests,
    validUntil: null,
    notes: quote.notes ?? '',
    refreshMenuPrices: false,
  };
}

function trimTranslatable(value: Translatable): Translatable {
  const result: Translatable = {};
  for (const [locale, text] of Object.entries(value) as Array<[keyof Translatable, string | undefined]>) {
    const v = text?.trim();
    if (v) result[locale] = v;
  }
  return result;
}

function validQuantity(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= MAX_LINE_QUANTITY;
}

/**
 * Форма → тело POST /requests/{id}/quotes. Проверки — те же, что делает сервер (подсказки до отправки);
 * суммы не считаются.
 */
export function formToSaveInput(values: QuoteFormValues): SaveQuoteResult {
  const issues: QuoteFormIssue[] = [];
  if (values.lines.length === 0) issues.push({ code: 'noLines', field: 'lines' });
  if (values.lines.length > MAX_QUOTE_LINES) issues.push({ code: 'tooManyLines', field: 'lines' });

  const lines: QuoteLineInput[] = [];
  values.lines.forEach((line, index) => {
    const at = index + 1;
    const lineIssues: QuoteFormIssue[] = [];
    if (!validQuantity(line.quantity)) lineIssues.push({ code: 'quantityInvalid', line: at, field: 'quantity' });
    const unit = line.unit.trim();
    if (unit.length > MAX_UNIT_LENGTH) lineIssues.push({ code: 'unitTooLong', line: at, field: 'unit' });
    const discount = discountToApi(line.discount);
    if (!discount.ok) lineIssues.push({ code: discount.code, line: at, field: 'discount' });

    if (line.kind === 'menu') {
      if (!line.dishId) lineIssues.push({ code: 'dishRequired', line: at, field: 'dish' });
      issues.push(...lineIssues);
      if (lineIssues.length === 0) {
        lines.push({
          kind: 'menu',
          dishId: line.dishId!,
          quantity: line.quantity!,
          ...(unit ? { unit } : {}),
          ...(discount.ok && discount.value ? { discount: discount.value } : {}),
        });
      }
      return;
    }

    const title = trimTranslatable(line.title);
    if (!title.kk && !title.ru) lineIssues.push({ code: 'titleRequired', line: at, field: 'title' });
    if (!unit) lineIssues.push({ code: 'unitRequired', line: at, field: 'unit' });
    if (line.unitPrice === null || !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0) {
      lineIssues.push({ code: 'priceRequired', line: at, field: 'unitPrice' });
    }
    issues.push(...lineIssues);
    if (lineIssues.length === 0) {
      lines.push({
        kind: line.kind,
        title,
        unit,
        unitPrice: moneyInput(line.unitPrice!),
        quantity: line.quantity!,
        ...(discount.ok && discount.value ? { discount: discount.value } : {}),
      });
    }
  });

  const overall = discountToApi(values.discount);
  if (!overall.ok) issues.push({ code: overall.code, field: 'discount' });

  let serviceChargeBp = 0;
  if (values.serviceCharge.trim() !== '') {
    const bp = percentTextToBp(values.serviceCharge, MAX_SERVICE_CHARGE_BP);
    if (bp.ok) serviceChargeBp = bp.value;
    else issues.push({ code: 'serviceChargeInvalid', field: 'serviceCharge' });
  }

  if (values.guests !== null && (!Number.isInteger(values.guests) || values.guests < 1 || values.guests > 5000)) {
    issues.push({ code: 'guestsInvalid', field: 'guests' });
  }
  const notes = values.notes.trim();
  if (notes.length > MAX_NOTES_LENGTH) issues.push({ code: 'notesTooLong', field: 'notes' });

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    input: {
      lines,
      ...(overall.ok && overall.value ? { discount: overall.value } : {}),
      serviceChargeBp,
      ...(values.guests !== null ? { guests: values.guests } : {}),
      ...(values.validUntil ? { validUntil: values.validUntil } : {}),
      ...(notes ? { notes } : {}),
      ...(values.refreshMenuPrices ? { refreshMenuPrices: true } : {}),
    },
  };
}

/** Ошибки конкретной строки (для подсветки полей). */
export function lineIssues(issues: readonly QuoteFormIssue[], line: number): QuoteFormIssue[] {
  return issues.filter((i) => i.line === line);
}

/** Переставить строку (вверх/вниз). */
export function moveLine(lines: readonly QuoteLineForm[], index: number, delta: -1 | 1): QuoteLineForm[] {
  const target = index + delta;
  if (index < 0 || index >= lines.length || target < 0 || target >= lines.length) return [...lines];
  const next = [...lines];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}
