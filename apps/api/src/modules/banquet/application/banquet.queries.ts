import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { Money, MoneyJson } from '../../../shared/kernel/money';
import { Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { Permission } from '../../../shared/kernel/permissions';
import { addDays, isIsoDate, startOfLocalDay } from '../../../shared/kernel/time';
import { Translatable } from '../../../shared/kernel/translatable';
import { BranchDirectory, StaffDirectory } from '../../identity/public';
import { VenueAvailability, VenueOccupancy, VenueSummary } from '../../reservation/public';
import { ALL_BANQUET_STATUSES, availableTransitions } from '../domain/banquet-status';
import { BanquetRequest } from '../domain/banquet-request';
import { SlaStats, slaStats } from '../domain/sla';
import { ActivityRepository } from '../infrastructure/activity.repository';
import { CompanyRepository, ClientCompanyRecord } from '../infrastructure/company.repository';
import { DocumentRepository } from '../infrastructure/document.repository';
import { InvoiceRepository } from '../infrastructure/invoice.repository';
import { QuoteRepository } from '../infrastructure/quote.repository';
import { RequestFilter, RequestRepository } from '../infrastructure/request.repository';
import { BanquetStatus } from '../public';
import { assertCanView } from './access';
import { BanquetLinks } from './banquet-links';
import { BanquetSupport } from './banquet-support';
import { ManagerAssigner } from './manager-assigner';
import {
  ActivityView,
  activityView,
  ActView,
  actView,
  DocumentView,
  documentView,
  InvoiceView,
  invoiceView,
  QuoteSummaryView,
  quoteSummaryView,
  RequestSummaryView,
  requestSummaryView,
} from './views';

export interface RequestListQuery {
  status?: BanquetStatus[];
  managerId?: string;
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  isOffsite?: boolean;
  slaBreached?: boolean;
}

export interface RequestDetailView extends RequestSummaryView {
  wishes: string | null;
  locale: string;
  company: ClientCompanyRecord | null;
  allowedTransitions: BanquetStatus[];
  venue: { venueId: string; venueName: Translatable | null; reservationId: string; start: Date; end: Date } | null;
  prepayment: { required: MoneyJson | null; paid: MoneyJson; remaining: MoneyJson | null; covered: boolean; isCustom: boolean };
  balance: { quoteTotal: MoneyJson | null; invoiced: MoneyJson; paid: MoneyJson; remaining: MoneyJson | null };
  contractNumber: string | null;
  contractDate: string | null;
  cancelReason: string | null;
  heldAt: Date | null;
  cancelledAt: Date | null;
  publicQuoteUrl: string;
  quotes: QuoteSummaryView[];
  invoices: InvoiceView[];
  act: ActView | null;
  documents: DocumentView[];
  timeline: ActivityView[];
}

export interface PipelineColumn {
  status: BanquetStatus;
  count: number;
  items: RequestSummaryView[];
}

export interface CalendarView {
  branchId: string;
  from: string;
  to: string;
  venues: VenueSummary[];
  occupancy: VenueOccupancy[];
  banquets: RequestSummaryView[];
}

export interface SlaStatsView extends SlaStats {
  from: string;
  to: string;
  targetShareBp: number;
  byManager: Array<SlaStats & { managerId: string; managerName: string }>;
}

export interface ManagerView {
  id: string;
  name: string;
  phone: string | null;
  email: string;
  openRequests: number;
}

/** Цель ТЗ: 95% заявок с ответом за 30 минут. */
export const SLA_TARGET_SHARE_BP = 9500;
const MAX_CALENDAR_DAYS = 93;

/** Запросы админки по заявкам: список, воронка, карточка, календарь, SLA, менеджеры. Только чтение. */
@Injectable()
export class BanquetQueries {
  constructor(
    private readonly requests: RequestRepository,
    private readonly quotes: QuoteRepository,
    private readonly invoices: InvoiceRepository,
    private readonly documents: DocumentRepository,
    private readonly activities: ActivityRepository,
    private readonly companies: CompanyRepository,
    private readonly support: BanquetSupport,
    private readonly assigner: ManagerAssigner,
    private readonly branches: BranchDirectory,
    private readonly staff: StaffDirectory,
    private readonly venues: VenueAvailability,
    private readonly links: BanquetLinks,
    private readonly clock: Clock,
  ) {}

  private filter(actor: Actor, query: RequestListQuery): RequestFilter {
    return {
      branches: actor.scopeBranches(Permission.BanquetsView, query.branchId ?? null),
      statuses: query.status,
      managerId: query.managerId,
      eventDateFrom: query.dateFrom,
      eventDateTo: query.dateTo,
      q: query.q,
      isOffsite: query.isOffsite,
      slaBreached: query.slaBreached,
    };
  }

  /** Сводки заявок с названиями филиалов, именами менеджеров и итогами последних смет. */
  async summaries(requests: BanquetRequest[]): Promise<RequestSummaryView[]> {
    const branches = new Map((await this.branches.list()).map((b) => [b.id, b.name]));
    const managerIds = [...new Set(requests.map((r) => r.managerId))];
    const managers = new Map<string, string>();
    for (const id of managerIds) managers.set(id, (await this.staff.get(id))?.name ?? '—');
    const totals = await this.quotes.latestTotals(requests.map((r) => r.id));
    const now = this.clock.now();
    return requests.map((r) => {
      const q = totals.get(r.id);
      return requestSummaryView(r, {
        branchName: r.branchId ? (branches.get(r.branchId) ?? null) : null,
        managerName: managers.get(r.managerId) ?? '—',
        quote: q ? { version: q.version, total: q.total.toJSON() } : null,
        now,
      });
    });
  }

  async list(actor: Actor, query: RequestListQuery, page: PageRequest): Promise<Page<RequestSummaryView>> {
    const { items, total } = await this.requests.list(this.filter(actor, query), page);
    return pageOf(await this.summaries(items), total, page);
  }

  /** Воронка: колонки по статусам (количество + ближайшие по дате мероприятия). */
  async pipeline(actor: Actor, query: RequestListQuery, perStatus = 50): Promise<PipelineColumn[]> {
    const filter = this.filter(actor, { ...query, status: undefined });
    const counts = await this.requests.countByStatus(filter);
    const columns: PipelineColumn[] = [];
    for (const status of ALL_BANQUET_STATUSES) {
      const items = (counts.get(status) ?? 0) > 0 ? await this.requests.latestByStatus(filter, status, perStatus) : [];
      columns.push({ status, count: counts.get(status) ?? 0, items: await this.summaries(items) });
    }
    return columns;
  }

  async detail(actor: Actor, id: string): Promise<RequestDetailView> {
    const request = await this.support.load(id);
    assertCanView(actor, request);
    const s = request.snapshot();
    const [summary] = await this.summaries([request]);
    const quote = await this.support.currentQuote(id);
    const latest = await this.quotes.latest(id);
    const versions = await this.quotes.listVersions(id);
    const invoices = await this.invoices.listForRequest(id);
    const payments = await this.invoices.paymentsOf(invoices.map((i) => i.id));
    const today = await this.support.today(s.branchId);
    const paid = Money.sum(invoices.map((i) => i.paid.subtract(i.refunded)));
    const invoiced = Money.sum(invoices.filter((i) => i.status !== 'cancelled').map((i) => i.amount));
    const quoteTotal = quote?.totals.total ?? null;
    const required = request.requiredPrepayment(quoteTotal);
    const covered = request.isPrepaymentCovered(paid, quoteTotal);
    const act = await this.documents.actOfRequest(id);
    let venueName: Translatable | null = null;
    if (s.venue) {
      try {
        venueName = (await this.venues.getVenue(s.venue.venueId)).name;
      } catch {
        venueName = null;
      }
    }
    return {
      ...summary!,
      wishes: s.wishes,
      locale: s.locale,
      company: s.companyId ? await this.companies.findById(s.companyId) : null,
      allowedTransitions: availableTransitions({
        status: s.status,
        hasQuote: latest !== null,
        latestQuoteSent: latest?.sentAt !== null && latest?.sentAt !== undefined,
        prepaymentCovered: covered,
        eventDateReached: s.eventDate <= today,
      }),
      venue: s.venue ? { ...s.venue, venueName } : null,
      prepayment: {
        required: required?.toJSON() ?? null,
        paid: paid.toJSON(),
        remaining: required ? required.subtract(paid).clampToZero().toJSON() : null,
        covered,
        isCustom: s.prepaymentIsCustom,
      },
      balance: {
        quoteTotal: quoteTotal?.toJSON() ?? null,
        invoiced: invoiced.toJSON(),
        paid: paid.toJSON(),
        remaining: quoteTotal ? quoteTotal.subtract(paid).clampToZero().toJSON() : null,
      },
      contractNumber: s.contractNumber,
      contractDate: s.contractDate,
      cancelReason: s.cancelReason,
      heldAt: s.heldAt,
      cancelledAt: s.cancelledAt,
      publicQuoteUrl: this.links.quote(s.publicToken, s.locale),
      quotes: versions.map((v) => quoteSummaryView(v, latest?.version ?? null)),
      invoices: invoices.map((i) => invoiceView(i, payments, { today, publicUrl: this.links.invoice(i.publicToken, s.locale) })),
      act: act ? actView(act) : null,
      documents: (await this.documents.listForRequest(id)).map(documentView),
      timeline: (await this.activities.list(id)).map(activityView),
    };
  }

  /** Календарь мероприятий филиала: заявки, залы и занятость (брони и банкеты) из модуля Reservation. */
  async calendar(actor: Actor, input: { branchId: string; from: string; to: string }): Promise<CalendarView> {
    actor.assertCan(Permission.BanquetsView, input.branchId);
    if (!isIsoDate(input.from) || !isIsoDate(input.to) || input.to < input.from) {
      throw new ValidationError('banquet.calendar_range_invalid', 'Expected from <= to (YYYY-MM-DD)');
    }
    if (input.to > addDays(input.from, MAX_CALENDAR_DAYS)) {
      throw new ValidationError('banquet.calendar_range_too_long', `Calendar range is limited to ${MAX_CALENDAR_DAYS} days`);
    }
    const branch = await this.branches.get(input.branchId);
    const fromUtc = startOfLocalDay(input.from, branch.timezone);
    const toUtc = startOfLocalDay(addDays(input.to, 1), branch.timezone);
    const requests = await this.requests.forCalendar(input.branchId, { from: input.from, to: input.to, fromUtc, toUtc });
    return {
      branchId: input.branchId,
      from: input.from,
      to: input.to,
      venues: await this.venues.listVenues(input.branchId),
      occupancy: await this.venues.occupancy(input.branchId, fromUtc, toUtc),
      banquets: await this.summaries(requests),
    };
  }

  /** Статистика SLA первого ответа за период (по дате создания заявок), всего и по менеджерам. */
  async slaStats(actor: Actor, input: { from: string; to: string; branchId?: string }): Promise<SlaStatsView> {
    if (!isIsoDate(input.from) || !isIsoDate(input.to) || input.to < input.from) {
      throw new ValidationError('banquet.sla_range_invalid', 'Expected from <= to (YYYY-MM-DD)');
    }
    const filter = this.filter(actor, { branchId: input.branchId });
    const rows = await this.requests.slaRows({
      ...filter,
      createdFrom: startOfLocalDay(input.from),
      createdTo: startOfLocalDay(addDays(input.to, 1)),
    });
    const now = this.clock.now();
    const subjects = rows.map((r) => ({
      status: r.status as BanquetStatus,
      createdAt: r.created_at,
      firstResponseAt: r.first_response_at,
      managerId: r.manager_id,
    }));
    const byManager = new Map<string, typeof subjects>();
    for (const s of subjects) byManager.set(s.managerId, [...(byManager.get(s.managerId) ?? []), s]);
    const managers: SlaStatsView['byManager'] = [];
    for (const [managerId, list] of byManager) {
      managers.push({ managerId, managerName: (await this.staff.get(managerId))?.name ?? '—', ...slaStats(list, now) });
    }
    managers.sort((a, b) => a.managerName.localeCompare(b.managerName));
    return { from: input.from, to: input.to, targetShareBp: SLA_TARGET_SHARE_BP, ...slaStats(subjects, now), byManager: managers };
  }

  /** Кому можно назначить заявку, с текущей нагрузкой. */
  async managers(actor: Actor): Promise<ManagerView[]> {
    actor.assertCanSomewhere(Permission.BanquetsView);
    const members = await this.assigner.candidates();
    const loads = await this.requests.managerLoads(members.map((m) => m.id));
    return members
      .map((m) => ({ id: m.id, name: m.name, phone: m.phone, email: m.email, openRequests: loads.get(m.id)?.openRequests ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async requireVisible(actor: Actor, id: string): Promise<BanquetRequest> {
    const request = await this.requests.findById(id);
    if (!request) throw new NotFoundError('banquet_request', id);
    assertCanView(actor, request);
    return request;
  }
}
