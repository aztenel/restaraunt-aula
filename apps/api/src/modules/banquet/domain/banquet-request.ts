import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { addDays, isHhMm, isIsoDate } from '../../../shared/kernel/time';
import { Locale } from '../../../shared/kernel/translatable';
import { BanquetContact, BanquetStatus } from '../public';
import { BANQUET_FSM, isOpenStatus } from './banquet-status';
import { isSlaBreached } from './sla';
import { BANQUET_EVENT_TYPES, BanquetEventType } from './texts';

/** Максимум гостей в одной заявке (защита от опечаток). */
export const MAX_GUESTS = 5000;
/** На сколько дней вперёд принимаются заявки. */
export const MAX_DAYS_AHEAD = 730;
/** Предоплата по умолчанию — 50% итога согласованной сметы. */
export const DEFAULT_PREPAYMENT_BP = 5000;

export type BanquetSource = 'web' | 'admin';

export interface BanquetVenueHold {
  venueId: string;
  /** Занятость места в модуле Reservation (вид брони banquet). */
  reservationId: string;
  start: Date;
  end: Date;
}

export interface BanquetRequestState {
  id: string;
  number: string;
  status: BanquetStatus;
  source: BanquetSource;
  /** Филиал проведения; для выезда — филиал-исполнитель (может быть ещё не выбран). */
  branchId: string | null;
  isOffsite: boolean;
  offsiteAddress: string | null;
  eventDate: string;
  eventTime: string | null;
  eventType: BanquetEventType;
  guests: number;
  budget: Money | null;
  contact: BanquetContact;
  wishes: string | null;
  locale: Locale;
  managerId: string;
  assignedAt: Date;
  companyId: string | null;
  prepaymentAmount: Money | null;
  /** Сумму предоплаты задал менеджер (не пересчитывается от сметы). */
  prepaymentIsCustom: boolean;
  venue: BanquetVenueHold | null;
  contractNumber: string | null;
  contractDate: string | null;
  firstResponseAt: Date | null;
  slaBreachedAt: Date | null;
  cancelReason: string | null;
  heldAt: Date | null;
  cancelledAt: Date | null;
  publicToken: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BanquetTransition {
  from: BanquetStatus;
  to: BanquetStatus;
  reason: string | null;
  at: Date;
}

/** Параметры мероприятия, которые вводит гость или менеджер. */
export interface BanquetDetails {
  eventDate: string;
  eventTime: string | null;
  eventType: BanquetEventType;
  guests: number;
  budget: Money | null;
  branchId: string | null;
  isOffsite: boolean;
  offsiteAddress: string | null;
  wishes: string | null;
}

export interface BanquetDetailsInput {
  eventDate: string;
  eventTime?: string | null;
  eventType: string;
  guests: number;
  budget?: Money | null;
  branchId?: string | null;
  isOffsite?: boolean;
  offsiteAddress?: string | null;
  wishes?: string | null;
}

function cleanText(value: string | null | undefined, max: number, code: string): string | null {
  const text = value?.trim() ?? '';
  if (!text) return null;
  if (text.length > max) throw new ValidationError(code, `Text is longer than ${max} characters`, { max });
  return text;
}

/**
 * Проверка параметров мероприятия. checkDate=false — дата не проверяется на «не в прошлом»
 * (правка деталей заявки, у которой дата не менялась).
 */
export function validateDetails(input: BanquetDetailsInput, today: string, options: { checkDate: boolean }): BanquetDetails {
  if (!(BANQUET_EVENT_TYPES as readonly string[]).includes(input.eventType)) {
    throw new ValidationError('banquet.invalid_event_type', 'Unknown event type', { eventType: input.eventType, allowed: BANQUET_EVENT_TYPES });
  }
  if (!Number.isInteger(input.guests) || input.guests < 1 || input.guests > MAX_GUESTS) {
    throw new ValidationError('banquet.invalid_guests', `Guests must be an integer 1..${MAX_GUESTS}`);
  }
  if (!isIsoDate(input.eventDate)) {
    throw new ValidationError('banquet.invalid_event_date', 'Event date must be YYYY-MM-DD');
  }
  if (options.checkDate) {
    if (input.eventDate < today) throw new ValidationError('banquet.event_date_in_past', 'Event date is in the past', { today });
    if (input.eventDate > addDays(today, MAX_DAYS_AHEAD)) {
      throw new ValidationError('banquet.event_date_too_far', `Event date is more than ${MAX_DAYS_AHEAD} days ahead`);
    }
  }
  const eventTime = input.eventTime?.trim() || null;
  if (eventTime && !isHhMm(eventTime)) throw new ValidationError('banquet.invalid_event_time', 'Event time must be HH:mm');
  const budget = input.budget ?? null;
  if (budget && budget.isNegative()) throw new ValidationError('banquet.invalid_budget', 'Budget cannot be negative');
  const isOffsite = input.isOffsite ?? false;
  const offsiteAddress = isOffsite ? cleanText(input.offsiteAddress, 500, 'banquet.offsite_address_too_long') : null;
  if (isOffsite && (!offsiteAddress || offsiteAddress.length < 5)) {
    throw new ValidationError('banquet.offsite_address_required', 'Address is required for offsite catering');
  }
  const branchId = input.branchId ?? null;
  if (!isOffsite && !branchId) throw new ValidationError('banquet.branch_required', 'Branch is required (or offsite catering with address)');
  return {
    eventDate: input.eventDate,
    eventTime,
    eventType: input.eventType as BanquetEventType,
    guests: input.guests,
    budget,
    branchId,
    isOffsite,
    offsiteAddress,
    wishes: cleanText(input.wishes, 4000, 'banquet.wishes_too_long'),
  };
}

/**
 * Банкетная заявка. Статус меняется только через transition() по автомату BANQUET_FSM.
 * Инвариант: у заявки всегда есть ответственный менеджер (managerId обязателен, снять нельзя — только переназначить).
 */
export class BanquetRequest {
  private pending: BanquetTransition[] = [];

  constructor(private state: BanquetRequestState) {
    if (!state.managerId) throw new ConflictError('banquet.manager_required', 'Banquet request must have a responsible manager');
  }

  static create(input: Omit<BanquetRequestState, 'status' | 'updatedAt' | 'firstResponseAt' | 'slaBreachedAt' | 'cancelReason' | 'heldAt' | 'cancelledAt' | 'venue' | 'contractNumber' | 'contractDate' | 'prepaymentAmount' | 'prepaymentIsCustom'>): BanquetRequest {
    return new BanquetRequest({
      ...input,
      status: 'new',
      updatedAt: input.createdAt,
      firstResponseAt: null,
      slaBreachedAt: null,
      cancelReason: null,
      heldAt: null,
      cancelledAt: null,
      venue: null,
      contractNumber: null,
      contractDate: null,
      prepaymentAmount: null,
      prepaymentIsCustom: false,
    });
  }

  get id(): string {
    return this.state.id;
  }

  get status(): BanquetStatus {
    return this.state.status;
  }

  get branchId(): string | null {
    return this.state.branchId;
  }

  get managerId(): string {
    return this.state.managerId;
  }

  get number(): string {
    return this.state.number;
  }

  snapshot(): Readonly<BanquetRequestState> {
    return this.state;
  }

  isOpen(): boolean {
    return isOpenStatus(this.state.status);
  }

  assertOpen(): void {
    if (!this.isOpen()) {
      throw new ConflictError('banquet.request_closed', `Request is ${this.state.status}`, { status: this.state.status });
    }
  }

  canTransition(to: BanquetStatus): boolean {
    return BANQUET_FSM.canTransition(this.state.status, to);
  }

  /** Переход по автомату. Недопустимый — InvalidStateTransitionError (409). */
  transition(to: BanquetStatus, now: Date, reason: string | null = null): BanquetTransition {
    const from = this.state.status;
    BANQUET_FSM.assertTransition(from, to);
    const next: BanquetRequestState = { ...this.state, status: to, updatedAt: now };
    if (to === 'held') next.heldAt = now;
    if (to === 'cancelled') {
      next.cancelledAt = now;
      next.cancelReason = reason;
    }
    this.state = next;
    const t: BanquetTransition = { from, to, reason, at: now };
    this.pending.push(t);
    return t;
  }

  pullTransitions(): BanquetTransition[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Первое действие менеджера (взятие в работу, отметка контакта). true — это первый ответ. */
  markResponded(now: Date): boolean {
    if (this.state.firstResponseAt) return false;
    this.state = { ...this.state, firstResponseAt: now };
    return true;
  }

  isSlaBreached(now: Date): boolean {
    return isSlaBreached(this.state, now);
  }

  markSlaBreached(now: Date): void {
    this.state = { ...this.state, slaBreachedAt: this.state.slaBreachedAt ?? now };
  }

  /** Переназначение ответственного. Возвращает прежнего менеджера. */
  assign(managerId: string, now: Date): string {
    if (!managerId) throw new ConflictError('banquet.manager_required', 'Banquet request must have a responsible manager');
    const previous = this.state.managerId;
    this.state = { ...this.state, managerId, assignedAt: now };
    return previous;
  }

  updateDetails(details: BanquetDetails): void {
    this.state = { ...this.state, ...details };
  }

  updateContact(contact: BanquetContact): void {
    this.state = { ...this.state, contact };
  }

  setCompany(companyId: string | null): void {
    this.state = { ...this.state, companyId };
  }

  setVenue(venue: BanquetVenueHold | null): void {
    this.state = { ...this.state, venue };
  }

  setContract(number: string, date: string): void {
    this.state = { ...this.state, contractNumber: number, contractDate: date };
  }

  /** Сумма предоплаты вручную (null — вернуть расчёт по умолчанию от сметы). */
  setPrepayment(amount: Money | null): void {
    if (amount && amount.isNegative()) throw new ValidationError('banquet.invalid_prepayment', 'Prepayment cannot be negative');
    this.state = { ...this.state, prepaymentAmount: amount, prepaymentIsCustom: amount !== null };
  }

  /** При согласовании сметы: предоплата по умолчанию — 50% итога, если менеджер не задал сумму сам. */
  applyDefaultPrepayment(quoteTotal: Money): void {
    if (this.state.prepaymentIsCustom) return;
    this.state = { ...this.state, prepaymentAmount: quoteTotal.percentage(DEFAULT_PREPAYMENT_BP) };
  }

  /** Требуемая предоплата: заданная сумма или 50% итога актуальной сметы; null — сметы ещё нет. */
  requiredPrepayment(quoteTotal: Money | null): Money | null {
    if (this.state.prepaymentIsCustom && this.state.prepaymentAmount) return this.state.prepaymentAmount;
    if (quoteTotal) return quoteTotal.percentage(DEFAULT_PREPAYMENT_BP);
    return this.state.prepaymentAmount;
  }

  /** Оплачено не меньше требуемой предоплаты. Нулевая предоплата считается покрытой, только если её задал менеджер. */
  isPrepaymentCovered(paidNet: Money, quoteTotal: Money | null): boolean {
    const required = this.requiredPrepayment(quoteTotal);
    if (!required) return false;
    if (required.isZero()) return this.state.prepaymentIsCustom;
    return paidNet.greaterThanOrEqual(required);
  }

  contact(): BanquetContact {
    return { ...this.state.contact };
  }

  /** Снимок для журнала действий (было/стало). */
  auditView(): Record<string, unknown> {
    const s = this.state;
    return {
      number: s.number,
      status: s.status,
      branchId: s.branchId,
      isOffsite: s.isOffsite,
      offsiteAddress: s.offsiteAddress,
      eventDate: s.eventDate,
      eventTime: s.eventTime,
      eventType: s.eventType,
      guests: s.guests,
      budget: s.budget?.toJSON() ?? null,
      managerId: s.managerId,
      companyId: s.companyId,
      prepaymentAmount: s.prepaymentAmount?.toJSON() ?? null,
      prepaymentIsCustom: s.prepaymentIsCustom,
      venue: s.venue ? { venueId: s.venue.venueId, start: s.venue.start.toISOString(), end: s.venue.end.toISOString() } : null,
      cancelReason: s.cancelReason,
    };
  }
}
