import { Injectable } from '@nestjs/common';
import { MoneyJson } from '../../../shared/kernel/money';
import { Translatable } from '../../../shared/kernel/translatable';
import { localDateTime } from '../domain/availability';
import { DepositOutcome, DepositState } from '../domain/deposit-policy';
import { pickVariant, StoredImage } from '../domain/images';
import { CancelledBy, Reservation } from '../domain/reservation';
import { isBlockingStatus } from '../domain/reservation-status';
import { VenuePosition } from '../domain/venue';
import { VenueRuleOverrides, VenueRules } from '../domain/venue-rules';
import { ReservationImageStorage } from '../infrastructure/image-storage';
import { HallRecord } from '../infrastructure/hall.repository';
import { ReservationVenueRef, StatusHistoryEntry } from '../infrastructure/reservation.repository';
import { VenueTypeRecord } from '../infrastructure/venue-type.repository';
import { VenueDetails } from '../infrastructure/venue.repository';
import { ReservationKind, ReservationSource, ReservationStatus } from '../public';

/**
 * Представления для HTTP-слоя (форма совпадает с DTO). Админка получает переводимые поля целиком,
 * витрина — уже переведённые строки (?locale=).
 */
export interface ImageView {
  id: string;
  /** Основной вариант (для карточки). */
  url: string;
  /** Уменьшенный вариант (для списков и карты). */
  thumbnailUrl: string;
  width: number;
  height: number;
  variants: Array<{ width: number; height: number; url: string }>;
}

export interface VenueTypeView {
  id: string;
  code: string;
  name: Translatable;
  description: Translatable;
  rules: VenueRules;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface HallView {
  id: string;
  branchId: string;
  code: string;
  name: Translatable;
  description: Translatable;
  planWidth: number;
  planHeight: number;
  background: ImageView | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VenueView {
  id: string;
  branchId: string;
  hallId: string;
  hallName: Translatable;
  typeId: string;
  typeCode: string;
  typeName: Translatable;
  code: string;
  name: Translatable;
  description: Translatable;
  capacityMin: number;
  capacityMax: number;
  deposit: MoneyJson | null;
  ruleOverrides: VenueRuleOverrides;
  rules: VenueRules;
  position: VenuePosition;
  photos: ImageView[];
  sortOrder: number;
  isActive: boolean;
  /** Место доступно для брони: активно само, его зал и тип. */
  isBookable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReservationCustomerView {
  id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export interface ReservationVenueView {
  id: string;
  code: string;
  name: Translatable;
  hallId: string;
  hallName: Translatable;
  typeCode: string;
  typeName: Translatable;
}

export interface ReservationSummaryView {
  id: string;
  number: string;
  branchId: string;
  kind: ReservationKind;
  status: ReservationStatus;
  source: ReservationSource;
  venue: ReservationVenueView;
  start: Date;
  end: Date;
  blockedUntil: Date;
  /** Локальные дата и время начала (часовой пояс филиала). */
  date: string;
  time: string;
  durationMinutes: number;
  guests: number;
  customer: ReservationCustomerView;
  comment: string | null;
  occasion: string | null;
  note: string | null;
  deposit: MoneyJson | null;
  depositState: DepositState;
  depositOutcome: DepositOutcome;
  holdExpiresAt: Date | null;
  banquetRequestId: string | null;
  /** Подтверждённая бронь уже началась, отметки «пришли / не пришли» нет. */
  needsMark: boolean;
  createdAt: Date;
}

export interface DepositPaymentView {
  id: string;
  status: string;
  amount: MoneyJson;
  refundedAmount: MoneyJson;
  paymentUrl: string | null;
  paidAt: Date | null;
}

export interface StatusHistoryView {
  from: ReservationStatus | null;
  to: ReservationStatus;
  reason: string | null;
  depositOutcome: DepositOutcome;
  actorKind: string;
  actorName: string;
  occurredAt: Date;
}

export interface ReservationDetailView extends ReservationSummaryView {
  allowedTransitions: ReservationStatus[];
  canReschedule: boolean;
  rules: VenueRules;
  cancellationDeadline: Date;
  /** Что будет с депозитом при отмене сейчас по правилу (сотрудник может решить иначе). */
  depositOutcomeIfCancelled: DepositOutcome;
  depositPayment: DepositPaymentView | null;
  depositWaiveReason: string | null;
  depositPaidAt: Date | null;
  cancelReason: string | null;
  cancelledBy: CancelledBy | null;
  confirmedAt: Date | null;
  arrivedAt: Date | null;
  noShowAt: Date | null;
  cancelledAt: Date | null;
  expiredAt: Date | null;
  reminderSentAt: Date | null;
  manageUrl: string | null;
  history: StatusHistoryView[];
}

@Injectable()
export class ReservationViewMapper {
  constructor(private readonly images: ReservationImageStorage) {}

  image(image: StoredImage | null): ImageView | null {
    if (!image) return null;
    const main = pickVariant(image, 800);
    const thumb = pickVariant(image, 400);
    if (!main || !thumb) return null;
    return {
      id: image.id,
      url: this.images.publicUrl(main.key),
      thumbnailUrl: this.images.publicUrl(thumb.key),
      width: main.width,
      height: main.height,
      variants: [...image.variants]
        .sort((a, b) => a.width - b.width)
        .map((v) => ({ width: v.width, height: v.height, url: this.images.publicUrl(v.key) })),
    };
  }

  images(list: readonly StoredImage[]): ImageView[] {
    return list.map((i) => this.image(i)).filter((i): i is ImageView => i !== null);
  }

  venueType(t: VenueTypeRecord): VenueTypeView {
    return { ...t, rules: { ...t.rules } };
  }

  hall(h: HallRecord): HallView {
    return {
      id: h.id,
      branchId: h.branchId,
      code: h.code,
      name: h.name,
      description: h.description,
      planWidth: h.plan.width,
      planHeight: h.plan.height,
      background: this.image(h.background),
      sortOrder: h.sortOrder,
      isActive: h.isActive,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
    };
  }

  venue(v: VenueDetails): VenueView {
    return {
      id: v.id,
      branchId: v.branchId,
      hallId: v.hallId,
      hallName: v.hall.name,
      typeId: v.typeId,
      typeCode: v.type.code,
      typeName: v.type.name,
      code: v.code,
      name: v.name,
      description: v.description,
      capacityMin: v.capacityMin,
      capacityMax: v.capacityMax,
      deposit: v.deposit?.toJSON() ?? null,
      ruleOverrides: { ...v.ruleOverrides },
      rules: { ...v.rules },
      position: { ...v.position },
      photos: this.images(v.photos),
      sortOrder: v.sortOrder,
      isActive: v.isActive,
      isBookable: v.isActive && v.hall.isActive && v.type.isActive,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
  }

  summary(r: Reservation, venue: ReservationVenueRef, timezone: string, now: Date): ReservationSummaryView {
    const p = r.snapshot();
    const local = localDateTime(p.start, timezone);
    return {
      id: p.id,
      number: p.number,
      branchId: p.branchId,
      kind: p.kind,
      status: p.status,
      source: p.source,
      venue: { ...venue },
      start: p.start,
      end: p.end,
      blockedUntil: p.blockedUntil,
      date: local.date,
      time: local.time,
      durationMinutes: Math.round((p.end.getTime() - p.start.getTime()) / 60_000),
      guests: p.guests,
      customer: { ...p.customer },
      comment: p.comment,
      occasion: p.occasion,
      note: p.note,
      deposit: p.deposit?.toJSON() ?? null,
      depositState: p.depositState,
      depositOutcome: p.depositOutcome,
      holdExpiresAt: p.holdExpiresAt,
      banquetRequestId: p.banquetRequestId,
      needsMark: r.needsMark(now),
      createdAt: p.createdAt,
    };
  }

  history(entries: readonly StatusHistoryEntry[]): StatusHistoryView[] {
    return entries.map((e) => ({
      from: e.from,
      to: e.to,
      reason: e.reason,
      depositOutcome: e.depositOutcome,
      actorKind: e.actorKind,
      actorName: e.actorName,
      occurredAt: e.occurredAt,
    }));
  }
}

/** Элемент календаря / карты зала. */
export interface TimelineItemView {
  reservationId: string;
  number: string;
  kind: ReservationKind;
  status: ReservationStatus;
  /** Занимает место (участвует в проверке пересечений). */
  blocking: boolean;
  start: Date;
  end: Date;
  blockedUntil: Date;
  guests: number;
  customerName: string | null;
  customerPhone: string | null;
  banquetRequestId: string | null;
  depositState: DepositState;
  needsMark: boolean;
}

export function timelineItem(r: Reservation, now: Date): TimelineItemView {
  const p = r.snapshot();
  return {
    reservationId: p.id,
    number: p.number,
    kind: p.kind,
    status: p.status,
    blocking: isBlockingStatus(p.status),
    start: p.start,
    end: p.end,
    blockedUntil: p.blockedUntil,
    guests: p.guests,
    customerName: p.customer.name,
    customerPhone: p.customer.phone,
    banquetRequestId: p.banquetRequestId,
    depositState: p.depositState,
    needsMark: r.needsMark(now),
  };
}
