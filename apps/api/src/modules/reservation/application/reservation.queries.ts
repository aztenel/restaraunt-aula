import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { MoneyJson } from '../../../shared/kernel/money';
import { Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { Permission } from '../../../shared/kernel/permissions';
import { addDays, DEFAULT_TIMEZONE, isIsoDate, openingRangesForDate, startOfLocalDay } from '../../../shared/kernel/time';
import { Locale, Translatable, translate } from '../../../shared/kernel/translatable';
import { BranchDirectory, BranchInfo } from '../../identity/public';
import { PaymentsService } from '../../payments/public';
import { localDateTime } from '../domain/availability';
import { DepositOutcome, DepositState } from '../domain/deposit-policy';
import { Reservation } from '../domain/reservation';
import { VenuePosition } from '../domain/venue';
import { VenueRules } from '../domain/venue-rules';
import { HallRepository } from '../infrastructure/hall.repository';
import { ReservationFilter, ReservationRepository } from '../infrastructure/reservation.repository';
import { ReservationSettingsRepository } from '../infrastructure/settings.repository';
import { VenueRepository } from '../infrastructure/venue.repository';
import { ReservationKind, ReservationSource, ReservationStatus } from '../public';
import { ReservationLinks } from './reservation-links';
import {
  DepositPaymentView,
  ImageView,
  ReservationDetailView,
  ReservationSummaryView,
  ReservationViewMapper,
  timelineItem,
  TimelineItemView,
} from './reservation-views';

export interface AdminReservationQuery {
  branchId?: string;
  /** Локальные даты начала брони (включительно). */
  dateFrom?: string;
  dateTo?: string;
  statuses?: ReservationStatus[];
  kind?: ReservationKind;
  source?: ReservationSource;
  venueId?: string;
  hallId?: string;
  q?: string;
  needsMark?: boolean;
}

export interface TimelineVenueView {
  id: string;
  code: string;
  name: Translatable;
  typeCode: string;
  typeName: Translatable;
  capacityMin: number;
  capacityMax: number;
  deposit: MoneyJson | null;
  position: VenuePosition;
  isActive: boolean;
  bookableOnline: boolean;
  /** Действующие правила места (длительность, уборка, удержание и т.д.). */
  rules: VenueRules;
  items: TimelineItemView[];
}

export interface TimelineHallView {
  id: string;
  code: string;
  name: Translatable;
  planWidth: number;
  planHeight: number;
  isActive: boolean;
  background: ImageView | null;
  venues: TimelineVenueView[];
}

export interface TimelineView {
  branchId: string;
  date: string;
  timezone: string;
  from: Date;
  to: Date;
  openingRanges: Array<{ start: Date; end: Date }>;
  halls: TimelineHallView[];
}

export interface PublicReservationView {
  token: string;
  number: string;
  status: ReservationStatus;
  branch: { id: string; slug: string; name: string; address: string; phone: string };
  venue: { id: string; name: string; typeCode: string; typeName: string; hallName: string };
  date: string;
  time: string;
  start: Date;
  end: Date;
  durationMinutes: number;
  guests: number;
  customerName: string | null;
  comment: string | null;
  occasion: string | null;
  holdExpiresAt: Date | null;
  deposit: {
    amount: MoneyJson;
    state: DepositState;
    outcome: DepositOutcome;
    paymentStatus: string | null;
    paymentUrl: string | null;
  } | null;
  canCancel: boolean;
  canPay: boolean;
  cancellationDeadline: Date;
  /** Что будет с депозитом при отмене сейчас: refunded (до дедлайна) / retained / none. */
  depositOutcomeIfCancelled: DepositOutcome;
  policy: { cancellationDeadlineHours: number; holdMinutes: number; requiresManualConfirmation: boolean; text: string };
  cancelledAt: Date | null;
  cancelReason: string | null;
}

/** Статусы в календаре: всё, кроме снятых и отменённых (они не занимают место). */
const TIMELINE_STATUSES: ReservationStatus[] = ['pending', 'awaiting_deposit', 'confirmed', 'arrived', 'no_show'];

function localDateRange(timezone: string, dateFrom?: string, dateTo?: string): { from?: Date; to?: Date } {
  for (const d of [dateFrom, dateTo]) {
    if (d && !isIsoDate(d)) throw new ValidationError('reservation.invalid_date', 'Expected date YYYY-MM-DD', { date: d });
  }
  return {
    from: dateFrom ? startOfLocalDay(dateFrom, timezone) : undefined,
    to: dateTo ? startOfLocalDay(addDays(dateTo, 1), timezone) : undefined,
  };
}

/** Чтение броней: список и карточка в админке, календарь / карта зала, страница брони гостя. */
@Injectable()
export class ReservationQueries {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly venues: VenueRepository,
    private readonly halls: HallRepository,
    private readonly settings: ReservationSettingsRepository,
    private readonly branches: BranchDirectory,
    private readonly payments: PaymentsService,
    private readonly views: ReservationViewMapper,
    private readonly links: ReservationLinks,
    private readonly clock: Clock,
  ) {}

  async list(actor: Actor, query: AdminReservationQuery, page: PageRequest): Promise<Page<ReservationSummaryView>> {
    const branchIds = actor.scopeBranches(Permission.ReservationsView, query.branchId);
    // Даты — в часовом поясе филиала (для списка по всем филиалам — пояс сети по умолчанию).
    const timezone = query.branchId ? (await this.branch(query.branchId)).timezone : DEFAULT_TIMEZONE;
    const now = this.clock.now();
    const filter: ReservationFilter = {
      branchIds,
      ...localDateRange(timezone, query.dateFrom, query.dateTo),
      statuses: query.statuses,
      kind: query.kind,
      source: query.source,
      venueId: query.venueId,
      hallId: query.hallId,
      q: query.q?.trim() || undefined,
      needsMarkAt: query.needsMark ? now : undefined,
    };
    const result = await this.reservations.list(filter, page);
    const zones = new Map<string, string>();
    const items: ReservationSummaryView[] = [];
    for (const { reservation, venue } of result.items) {
      if (!zones.has(reservation.branchId)) zones.set(reservation.branchId, (await this.branch(reservation.branchId)).timezone);
      items.push(this.views.summary(reservation, venue, zones.get(reservation.branchId)!, now));
    }
    return pageOf(items, result.total, page);
  }

  async detail(actor: Actor, id: string): Promise<ReservationDetailView> {
    const view = await this.reservations.findView(id);
    if (!view) throw new NotFoundError('reservation', id);
    actor.assertCan(Permission.ReservationsView, view.reservation.branchId);
    const r = view.reservation;
    const p = r.snapshot();
    const now = this.clock.now();
    const branch = await this.branch(r.branchId);
    return {
      ...this.views.summary(r, view.venue, branch.timezone, now),
      allowedTransitions: r.allowedTransitions(now),
      canReschedule: r.canReschedule(),
      rules: { ...p.rules },
      cancellationDeadline: r.cancellationDeadline(),
      depositOutcomeIfCancelled: r.depositOutcomeIfCancelled(now),
      depositPayment: await this.depositPayment(r),
      depositWaiveReason: p.depositWaiveReason,
      depositPaidAt: p.depositPaidAt,
      cancelReason: p.cancelReason,
      cancelledBy: p.cancelledBy,
      confirmedAt: p.confirmedAt,
      arrivedAt: p.arrivedAt,
      noShowAt: p.noShowAt,
      cancelledAt: p.cancelledAt,
      expiredAt: p.expiredAt,
      reminderSentAt: p.reminderSentAt,
      manageUrl: p.publicToken ? this.links.manage(p.publicToken, p.locale) : null,
      history: this.views.history(await this.reservations.history(r.id)),
    };
  }

  /** Календарь / карта зала на локальную дату: занятость каждого места, включая банкеты. */
  async timeline(actor: Actor, branchId: string, date: string): Promise<TimelineView> {
    actor.assertCan(Permission.ReservationsView, branchId);
    if (!isIsoDate(date)) throw new ValidationError('reservation.invalid_date', 'Expected date YYYY-MM-DD', { date });
    const branch = await this.branch(branchId);
    const from = startOfLocalDay(date, branch.timezone);
    const to = startOfLocalDay(addDays(date, 1), branch.timezone);
    const now = this.clock.now();
    const halls = await this.halls.list({ branchIds: [branchId] });
    const venues = await this.venues.listDetailed({ branchIds: [branchId] });
    const items = await this.reservations.timeline(branchId, from, to, TIMELINE_STATUSES);
    return {
      branchId,
      date,
      timezone: branch.timezone,
      from,
      to,
      openingRanges: openingRangesForDate(branch.openingHours, date, branch.timezone).map((r) => ({ start: r.start, end: r.end })),
      halls: halls.map((h) => ({
        id: h.id,
        code: h.code,
        name: h.name,
        planWidth: h.plan.width,
        planHeight: h.plan.height,
        isActive: h.isActive,
        background: this.views.image(h.background),
        venues: venues
          .filter((v) => v.hallId === h.id)
          .map((v) => ({
            id: v.id,
            code: v.code,
            name: v.name,
            typeCode: v.type.code,
            typeName: v.type.name,
            capacityMin: v.capacityMin,
            capacityMax: v.capacityMax,
            deposit: v.deposit?.toJSON() ?? null,
            position: { ...v.position },
            isActive: v.isActive && v.type.isActive,
            bookableOnline: v.rules.bookableOnline,
            rules: { ...v.rules },
            items: items.filter((i) => i.reservation.venueId === v.id).map((i) => timelineItem(i.reservation, now)),
          })),
      })),
    };
  }

  /** Страница брони гостя (по публичному токену): статус, депозит и оплата, можно ли отменить, правила. */
  async publicDetail(token: string, locale: Locale): Promise<PublicReservationView> {
    const found = await this.reservations.findByToken(token);
    if (!found) throw new NotFoundError('reservation');
    const view = (await this.reservations.findView(found.id))!;
    const r = view.reservation;
    const p = r.snapshot();
    const now = this.clock.now();
    const branch = await this.branch(r.branchId);
    const settings = await this.settings.get(r.branchId);
    const local = localDateTime(p.start, branch.timezone);
    const payment = await this.depositPayment(r);
    return {
      token: p.publicToken!,
      number: p.number,
      status: p.status,
      branch: {
        id: branch.id,
        slug: branch.slug,
        name: translate(branch.name, locale),
        address: translate(branch.address, locale),
        phone: branch.phone,
      },
      venue: {
        id: view.venue.id,
        name: translate(view.venue.name, locale),
        typeCode: view.venue.typeCode,
        typeName: translate(view.venue.typeName, locale),
        hallName: translate(view.venue.hallName, locale),
      },
      date: local.date,
      time: local.time,
      start: p.start,
      end: p.end,
      durationMinutes: Math.round((p.end.getTime() - p.start.getTime()) / 60_000),
      guests: p.guests,
      customerName: p.customer.name,
      comment: p.comment,
      occasion: p.occasion,
      holdExpiresAt: p.holdExpiresAt,
      deposit:
        p.deposit && p.depositState !== 'none' && p.depositState !== 'waived'
          ? {
              amount: p.deposit.toJSON(),
              state: p.depositState,
              outcome: p.depositOutcome,
              paymentStatus: payment?.status ?? null,
              paymentUrl: p.depositState === 'pending' ? (payment?.paymentUrl ?? null) : null,
            }
          : null,
      canCancel: r.guestCanCancel(now),
      canPay: r.guestCanPay(now),
      cancellationDeadline: r.cancellationDeadline(),
      depositOutcomeIfCancelled: r.depositOutcomeIfCancelled(now),
      policy: {
        cancellationDeadlineHours: p.rules.cancellationDeadlineHours,
        holdMinutes: p.rules.holdMinutes,
        requiresManualConfirmation: p.requiresConfirmation,
        text: translate(settings.policyText, locale),
      },
      cancelledAt: p.cancelledAt,
      cancelReason: p.cancelledBy === 'guest' ? p.cancelReason : null,
    };
  }

  private async depositPayment(r: Reservation): Promise<DepositPaymentView | null> {
    const id = r.depositPaidPaymentId ?? r.depositPaymentId;
    if (!id) return null;
    const payment = await this.payments.getPayment(id);
    return {
      id: payment.id,
      status: payment.status,
      amount: payment.amount.toJSON(),
      refundedAmount: payment.refundedAmount.toJSON(),
      paymentUrl: payment.paymentUrl,
      paidAt: payment.paidAt,
    };
  }

  private async branch(branchId: string): Promise<BranchInfo> {
    return this.branches.get(branchId);
  }
}
