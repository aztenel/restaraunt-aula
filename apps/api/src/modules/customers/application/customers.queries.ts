import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { MoneyJson } from '../../../shared/kernel/money';
import { Page, PageRequest } from '../../../shared/kernel/pagination';
import { Permission } from '../../../shared/kernel/permissions';
import { addDays, isIsoDate, startOfLocalDay } from '../../../shared/kernel/time';
import { Locale, translate } from '../../../shared/kernel/translatable';
import { StaffDirectory } from '../../identity/public';
import { assertConsentKind } from '../domain/consent';
import { CustomerFilter, mergeFilters, normalizeCustomerFilter } from '../domain/customer-filter';
import { ActivityType, periodTotals, PeriodTotals } from '../domain/history';
import { ActivityRepository, Period } from '../infrastructure/activity.repository';
import { ConsentRecord, ConsentRepository, ConsentTextRecord, ConsentTextRepository } from '../infrastructure/consent.repository';
import { CustomerRepository, CustomerSort } from '../infrastructure/customer.repository';
import { SegmentRecord, SegmentRepository } from '../infrastructure/segment.repository';
import { ConsentKind } from '../public';
import { CustomerAdminView, toAdminView } from './customer-views';

export interface ActivityView {
  id: string;
  type: ActivityType;
  entityType: string;
  entityId: string;
  branchId: string | null;
  amount: MoneyJson | null;
  countsAsSpent: boolean;
  summary: string;
  meta: Record<string, unknown>;
  occurredAt: Date;
}

export interface ConsentRecordView extends ConsentRecord {
  /** Имя сотрудника, внёсшего согласие (null — гость на витрине или сотрудник не найден). */
  recordedByName: string | null;
}

export interface CustomerDetailView {
  customer: CustomerAdminView;
  consents: ConsentRecordView[];
  period: { from: string | null; to: string | null };
  totals: Omit<PeriodTotals, 'spent'> & { spent: MoneyJson };
  activities: Page<ActivityView>;
}

export interface CustomerListQuery {
  filter: CustomerFilter | Record<string, unknown>;
  segmentId?: string | null;
  sort?: CustomerSort;
  order?: 'asc' | 'desc';
  includeAnonymized?: boolean;
}

/** Период «с даты по дату» (локальные даты Asia/Almaty, включительно) -> полуоткрытый интервал UTC. */
export function periodOf(from?: string | null, to?: string | null): Period {
  for (const [field, value] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (value && !isIsoDate(value)) throw new ValidationError('customer.period_invalid', `${field} must be YYYY-MM-DD`, { field });
  }
  if (from && to && from > to) throw new ValidationError('customer.period_invalid', 'from must not be after to');
  return { from: from ? startOfLocalDay(from) : null, to: to ? startOfLocalDay(addDays(to, 1)) : null };
}

/**
 * Чтение базы гостей для админки. Гости общие для сети: достаточно права customers.view
 * хотя бы в одном филиале.
 */
@Injectable()
export class CustomerQueries {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly consents: ConsentRepository,
    private readonly activities: ActivityRepository,
    private readonly segments: SegmentRepository,
    private readonly staff: StaffDirectory,
  ) {}

  async list(actor: Actor, query: CustomerListQuery, page: PageRequest): Promise<Page<CustomerAdminView>> {
    actor.assertCanSomewhere(Permission.CustomersView);
    let filter = normalizeCustomerFilter(query.filter);
    if (query.segmentId) {
      const segment = await this.segments.findById(query.segmentId);
      if (!segment) throw new NotFoundError('customer_segment', query.segmentId);
      filter = mergeFilters(normalizeCustomerFilter(segment.filter), filter);
    }
    const result = await this.customers.search(
      filter,
      { sort: query.sort ?? 'lastActivity', order: query.order ?? 'desc', includeAnonymized: query.includeAnonymized ?? false },
      page,
    );
    return { ...result, items: result.items.map(toAdminView) };
  }

  async detail(actor: Actor, customerId: string, query: { from?: string | null; to?: string | null }, page: PageRequest): Promise<CustomerDetailView> {
    actor.assertCanSomewhere(Permission.CustomersView);
    const customer = await this.customers.findById(customerId);
    if (!customer) throw new NotFoundError('customer', customerId);
    const period = periodOf(query.from, query.to);
    const [consents, stats, activities] = await Promise.all([
      this.consents.listForCustomer(customerId),
      this.activities.statsForCustomer(customerId, period),
      this.activities.listForCustomer(customerId, period, page),
    ]);
    const totals = periodTotals(stats);
    const names = await this.staff.names(consents.map((c) => c.recordedBy));
    return {
      customer: toAdminView(customer),
      consents: consents.map((c) => ({ ...c, recordedByName: c.recordedBy ? (names.get(c.recordedBy) ?? null) : null })),
      period: { from: query.from ?? null, to: query.to ?? null },
      totals: { ...totals, spent: totals.spent.toJSON() },
      activities: {
        ...activities,
        items: activities.items.map((a) => ({ ...a, amount: a.amount?.toJSON() ?? null })),
      },
    };
  }

  async tags(actor: Actor): Promise<Array<{ tag: string; count: number }>> {
    actor.assertCanSomewhere(Permission.CustomersView);
    return this.customers.tagStats();
  }
}

export interface SegmentView extends SegmentRecord {
  /** Сколько гостей сейчас в сегменте (без обезличенных). */
  customersCount: number;
  createdByName: string | null;
  updatedByName: string | null;
}

@Injectable()
export class SegmentQueries {
  constructor(
    private readonly segments: SegmentRepository,
    private readonly customers: CustomerRepository,
    private readonly staff: StaffDirectory,
  ) {}

  /** Сегменты с числом гостей (один запрос на все сегменты) и именами авторов. */
  async list(actor: Actor): Promise<SegmentView[]> {
    actor.assertCanSomewhere(Permission.CustomersView);
    return this.views(await this.segments.list());
  }

  /** Сегмент с текущим числом гостей (без обезличенных). */
  async get(actor: Actor, segmentId: string): Promise<SegmentView> {
    actor.assertCanSomewhere(Permission.CustomersView);
    const segment = await this.segments.findById(segmentId);
    if (!segment) throw new NotFoundError('customer_segment', segmentId);
    return (await this.views([segment]))[0]!;
  }

  private async views(segments: SegmentRecord[]): Promise<SegmentView[]> {
    const [counts, names] = await Promise.all([
      this.customers.countMany(segments.map((s) => normalizeCustomerFilter(s.filter))),
      this.staff.names(segments.flatMap((s) => [s.createdBy, s.updatedBy])),
    ]);
    return segments.map((s, i) => ({
      ...s,
      customersCount: counts[i] ?? 0,
      createdByName: s.createdBy ? (names.get(s.createdBy) ?? null) : null,
      updatedByName: s.updatedBy ? (names.get(s.updatedBy) ?? null) : null,
    }));
  }
}

export interface PublicConsentText {
  kind: ConsentKind;
  version: string;
  locale: Locale;
  text: string;
  publishedAt: Date;
}

export interface ConsentTextView extends ConsentTextRecord {
  isCurrent: boolean;
  publishedByName: string | null;
}

@Injectable()
export class ConsentTextQueries {
  constructor(
    private readonly texts: ConsentTextRepository,
    private readonly clock: Clock,
    private readonly staff: StaffDirectory,
  ) {}

  /** Опубликованный текст для ответа админке (с именем опубликовавшего). */
  async view(record: ConsentTextRecord, isCurrent: boolean): Promise<ConsentTextView> {
    const names = await this.staff.names([record.publishedBy]);
    return { ...record, isCurrent, publishedByName: record.publishedBy ? (names.get(record.publishedBy) ?? null) : null };
  }

  /** Действующий текст согласия для форм витрины (переведённый на язык запроса). */
  async current(rawKind: string, locale: Locale): Promise<PublicConsentText> {
    const kind = assertConsentKind(rawKind);
    const text = await this.texts.current(kind, this.clock.now());
    if (!text) throw new NotFoundError('consent_text', kind);
    return { kind, version: text.version, locale, text: translate(text.text, locale), publishedAt: text.publishedAt };
  }

  async list(actor: Actor, kind?: string | null): Promise<ConsentTextView[]> {
    actor.assertCanSomewhere(Permission.CustomersView);
    const k = kind ? assertConsentKind(kind) : undefined;
    const now = this.clock.now();
    const texts = await this.texts.list(k);
    const currentIds = new Set<string>();
    for (const kindKey of ['personal_data', 'marketing'] as const) {
      const current = await this.texts.current(kindKey, now);
      if (current) currentIds.add(current.id);
    }
    const names = await this.staff.names(texts.map((t) => t.publishedBy));
    return texts.map((t) => ({
      ...t,
      isCurrent: currentIds.has(t.id),
      publishedByName: t.publishedBy ? (names.get(t.publishedBy) ?? null) : null,
    }));
  }
}
