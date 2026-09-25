/**
 * Промокод: форма ⇄ API. Процент вводится строкой («10», «12,5») и уходит в базисных пунктах
 * (10% = 1000) без плавающей точки; суммы — целые тиыны. Срок действия — «стенные часы» Asia/Almaty
 * → ISO UTC. Применимость промокода к заказу считает только сервер.
 */
import { formatFixed2ForInput, parseFixed2, type Money, type ParseFixedError } from '@aula/api-client';
import type { Dayjs } from 'dayjs';
import { isoToPickerValue, pickerValueToIso } from '@/shared/lib/dates';

export const PROMO_KINDS = ['percent', 'fixed', 'free_delivery'] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export interface PromoUsage {
  /** Зарезервировано неоплаченными заказами. */
  reserved: number;
  /** Использовано оплаченными заказами. */
  used: number;
  /** Освобождено отменой до оплаты. */
  released: number;
}

export interface PromoCode {
  id: string;
  code: string;
  description: string | null;
  kind: PromoKind;
  percentBp: number | null;
  fixedAmount: Money | null;
  minSubtotal: Money | null;
  validFrom: string | null;
  validTo: string | null;
  totalLimit: number | null;
  perPhoneLimit: number | null;
  /** null — вся сеть. */
  branchId: string | null;
  isActive: boolean;
  usage: PromoUsage;
  /** Сотрудник может изменить промокод (решает сервер). */
  editable: boolean;
}

interface MoneyInput {
  amount: number;
  currency: 'KZT';
}

/** POST/PUT /admin/promo-codes */
export interface PromoCodeInput {
  code: string;
  description: string | null;
  kind: PromoKind;
  percentBp: number | null;
  fixedAmount: MoneyInput | null;
  minSubtotal: MoneyInput | null;
  validFrom: string | null;
  validTo: string | null;
  totalLimit: number | null;
  perPhoneLimit: number | null;
  branchId: string | null;
  isActive: boolean;
}

export interface PromoFormValues {
  code: string;
  description: string;
  kind: PromoKind;
  /** Процент строкой: «10», «12,5». */
  percent: string;
  /** Тиыны. */
  fixedAmount: number | null;
  minSubtotal: number | null;
  validFrom: Dayjs | null;
  validTo: Dayjs | null;
  totalLimit: number | null;
  perPhoneLimit: number | null;
  branchId: string | null;
  isActive: boolean;
}

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
export const MAX_PERCENT_BP = 10_000;

/** Как сервер: верхний регистр, без пробелов. */
export function normalizePromoCode(raw: string): string {
  return (raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

export type PercentParse = { ok: true; value: number } | { ok: false; error: ParseFixedError | 'out_of_range' };

/** «10» → 1000 б.п., «12,5» → 1250, «0,01» → 1; допустимо от 0,01 до 100%. */
export function percentTextToBp(text: string): PercentParse {
  const parsed = parseFixed2(text);
  if (!parsed.ok) return parsed;
  if (parsed.value < 1 || parsed.value > MAX_PERCENT_BP) return { ok: false, error: 'out_of_range' };
  return parsed;
}

/** 1000 → «10», 1250 → «12,50». */
export function bpToPercentText(bp: number | null | undefined, locale = 'ru'): string {
  return bp === null || bp === undefined ? '' : formatFixed2ForInput(bp, locale);
}

export function emptyPromoForm(branchId: string | null): PromoFormValues {
  return {
    code: '',
    description: '',
    kind: 'percent',
    percent: '',
    fixedAmount: null,
    minSubtotal: null,
    validFrom: null,
    validTo: null,
    totalLimit: null,
    perPhoneLimit: null,
    branchId,
    isActive: true,
  };
}

export function promoToFormValues(promo: PromoCode, locale = 'ru'): PromoFormValues {
  return {
    code: promo.code,
    description: promo.description ?? '',
    kind: promo.kind,
    percent: promo.kind === 'percent' ? bpToPercentText(promo.percentBp, locale) : '',
    fixedAmount: promo.kind === 'fixed' ? (promo.fixedAmount?.amount ?? null) : null,
    minSubtotal: promo.minSubtotal?.amount ?? null,
    validFrom: isoToPickerValue(promo.validFrom),
    validTo: isoToPickerValue(promo.validTo),
    totalLimit: promo.totalLimit,
    perPhoneLimit: promo.perPhoneLimit,
    branchId: promo.branchId,
    isActive: promo.isActive,
  };
}

export type PromoFormIssue =
  | 'code_format'
  | 'percent_required'
  | 'percent_invalid'
  | 'percent_range'
  | 'fixed_required'
  | 'fixed_positive'
  | 'amount_negative'
  | 'period_invalid'
  | 'limit_invalid'
  | 'description_too_long'
  | 'network_forbidden';

export type PromoFormErrors = Partial<
  Record<'code' | 'percent' | 'fixedAmount' | 'minSubtotal' | 'validTo' | 'totalLimit' | 'perPhoneLimit' | 'description' | 'branchId', PromoFormIssue>
>;

function limitIssue(value: number | null): PromoFormIssue | undefined {
  if (value === null || value === undefined) return undefined;
  return Number.isSafeInteger(value) && value >= 1 ? undefined : 'limit_invalid';
}

/**
 * Проверка ввода (зеркало правил PromoCodeInputDto / validatePromoDefinition на сервере).
 * canNetwork — у сотрудника глобальное право promocodes.manage (промокод на всю сеть).
 */
export function validatePromoForm(values: PromoFormValues, options: { canNetwork: boolean }): PromoFormErrors {
  const errors: PromoFormErrors = {};
  if (!CODE_RE.test(normalizePromoCode(values.code))) errors.code = 'code_format';
  if (values.kind === 'percent') {
    if (!values.percent.trim()) errors.percent = 'percent_required';
    else {
      const parsed = percentTextToBp(values.percent);
      if (!parsed.ok) errors.percent = parsed.error === 'out_of_range' || parsed.error === 'negative' ? 'percent_range' : 'percent_invalid';
    }
  }
  if (values.kind === 'fixed') {
    if (values.fixedAmount === null || values.fixedAmount === undefined) errors.fixedAmount = 'fixed_required';
    else if (values.fixedAmount <= 0) errors.fixedAmount = 'fixed_positive';
  }
  if (values.minSubtotal !== null && values.minSubtotal !== undefined && values.minSubtotal < 0) errors.minSubtotal = 'amount_negative';
  const from = pickerValueToIso(values.validFrom);
  const to = pickerValueToIso(values.validTo);
  if (from && to && from >= to) errors.validTo = 'period_invalid';
  const total = limitIssue(values.totalLimit);
  if (total) errors.totalLimit = total;
  const perPhone = limitIssue(values.perPhoneLimit);
  if (perPhone) errors.perPhoneLimit = perPhone;
  if (values.description.trim().length > 500) errors.description = 'description_too_long';
  if (values.branchId === null && !options.canNetwork) errors.branchId = 'network_forbidden';
  return errors;
}

function money(amount: number): MoneyInput {
  return { amount, currency: 'KZT' };
}

/** Форма → тело запроса. Поля, не относящиеся к типу скидки, отправляются как null. */
export function formValuesToPromoInput(values: PromoFormValues): PromoCodeInput {
  const percent = values.kind === 'percent' ? percentTextToBp(values.percent) : null;
  return {
    code: normalizePromoCode(values.code),
    description: values.description.trim() || null,
    kind: values.kind,
    percentBp: percent && percent.ok ? percent.value : null,
    fixedAmount: values.kind === 'fixed' && values.fixedAmount !== null ? money(values.fixedAmount) : null,
    minSubtotal: values.minSubtotal !== null && values.minSubtotal > 0 ? money(values.minSubtotal) : null,
    validFrom: pickerValueToIso(values.validFrom),
    validTo: pickerValueToIso(values.validTo),
    totalLimit: values.totalLimit ?? null,
    perPhoneLimit: values.perPhoneLimit ?? null,
    branchId: values.branchId,
    isActive: values.isActive,
  };
}

/** Промокод как есть с другим признаком активности (деактивация/активация через PUT). */
export function promoToInput(promo: PromoCode, patch: Partial<Pick<PromoCodeInput, 'isActive'>> = {}): PromoCodeInput {
  return {
    code: promo.code,
    description: promo.description,
    kind: promo.kind,
    percentBp: promo.kind === 'percent' ? promo.percentBp : null,
    fixedAmount: promo.kind === 'fixed' && promo.fixedAmount ? money(promo.fixedAmount.amount) : null,
    minSubtotal: promo.minSubtotal ? money(promo.minSubtotal.amount) : null,
    validFrom: promo.validFrom,
    validTo: promo.validTo,
    totalLimit: promo.totalLimit,
    perPhoneLimit: promo.perPhoneLimit,
    branchId: promo.branchId,
    isActive: patch.isActive ?? promo.isActive,
  };
}

export type PromoStatusFilter = 'all' | 'active' | 'inactive';
export type PromoScopeFilter = 'all' | 'network' | 'branch';

/**
 * Фильтры списка → параметры GET /admin/promo-codes. «На всю сеть» — без филиала (сетевые промокоды
 * не относятся к филиалу), «Филиальные» — промокоды филиалов (выбранного или всех доступных).
 */
export function promoListParams(filters: {
  search: string;
  status: PromoStatusFilter;
  scope: PromoScopeFilter;
  branchId?: string;
  page: number;
  perPage: number;
}): { q?: string; active?: boolean; scope?: 'network' | 'branch'; branchId?: string; page: number; perPage: number } {
  return {
    q: filters.search.trim() || undefined,
    active: filters.status === 'all' ? undefined : filters.status === 'active',
    scope: filters.scope === 'all' ? undefined : filters.scope,
    branchId: filters.scope === 'network' ? undefined : filters.branchId,
    page: filters.page,
    perPage: filters.perPage,
  };
}
