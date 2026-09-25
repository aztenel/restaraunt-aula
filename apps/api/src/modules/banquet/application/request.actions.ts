import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { Permission } from '../../../shared/kernel/permissions';
import { addDays, toLocalDate, toLocalTime, zonedTimeToUtc } from '../../../shared/kernel/time';
import { CustomerDirectory, CustomerTag } from '../../customers/public';
import { BranchDirectory } from '../../identity/public';
import { Notifier } from '../../notifications/public';
import { PaymentsService } from '../../payments/public';
import { VenueAvailability } from '../../reservation/public';
import { BanquetRequest, BanquetVenueHold, validateDetails } from '../domain/banquet-request';
import { formatDateRu } from '../domain/dates';
import { ActivityRepository, MANUAL_ACTIVITY_KINDS, ManualActivityKind, RESPONSE_ACTIVITY_KINDS } from '../infrastructure/activity.repository';
import { CompanyRepository } from '../infrastructure/company.repository';
import { invoiceEntity, InvoiceRepository } from '../infrastructure/invoice.repository';
import { QuoteRepository } from '../infrastructure/quote.repository';
import { RequestRepository } from '../infrastructure/request.repository';
import { BanquetEvents, BanquetStatus } from '../public';
import { assertCanManage } from './access';
import { requestAssignedPayload } from './banquet-events';
import { BanquetLinks } from './banquet-links';
import { BanquetSupport } from './banquet-support';
import { BanquetContactInput, normalizeContact } from './create-request.action';
import { BanquetFunnel } from './funnel';
import { ManagerAssigner } from './manager-assigner';
import { SendQuote } from './quote.actions';
import { BanquetStatusRecorder } from './status-recorder';

export interface UpdateBanquetRequestInput {
  eventDate?: string;
  eventTime?: string | null;
  eventType?: string;
  guests?: number;
  budget?: Money | null;
  branchId?: string | null;
  isOffsite?: boolean;
  offsiteAddress?: string | null;
  wishes?: string | null;
  contact?: BanquetContactInput;
  companyId?: string | null;
}

/**
 * Правка деталей заявки: дата, время, тип, гости, бюджет, филиал / выезд (филиал-исполнитель), контакт,
 * компания-заказчик. Если зал уже занят — занятость переносится на новую дату и число гостей
 * (конфликт в модуле Reservation — 409, ничего не меняется).
 */
@Injectable()
export class UpdateBanquetRequest {
  constructor(
    private readonly requests: RequestRepository,
    private readonly activities: ActivityRepository,
    private readonly companies: CompanyRepository,
    private readonly support: BanquetSupport,
    private readonly branches: BranchDirectory,
    private readonly customers: CustomerDirectory,
    private readonly venues: VenueAvailability,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string, input: UpdateBanquetRequestInput): Promise<BanquetRequest> {
    return this.database.transaction(async () => {
      const request = await this.support.load(id, { forUpdate: true });
      assertCanManage(actor, request);
      request.assertOpen();
      const current = request.snapshot();
      const before = request.auditView();
      const branchId = input.branchId !== undefined ? input.branchId : current.branchId;
      if (branchId !== current.branchId) {
        if (branchId) {
          const branch = await this.branches.find(branchId);
          if (!branch) throw new ValidationError('banquet.unknown_branch', 'Branch not found', { branchId });
        }
        actor.assertCan(Permission.BanquetsManage, branchId);
      }
      const isOffsite = input.isOffsite ?? current.isOffsite;
      const eventDate = input.eventDate ?? current.eventDate;
      const details = validateDetails(
        {
          eventDate,
          eventTime: input.eventTime !== undefined ? input.eventTime : current.eventTime,
          eventType: input.eventType ?? current.eventType,
          guests: input.guests ?? current.guests,
          budget: input.budget !== undefined ? input.budget : current.budget,
          branchId,
          isOffsite,
          offsiteAddress: input.offsiteAddress !== undefined ? input.offsiteAddress : current.offsiteAddress,
          wishes: input.wishes !== undefined ? input.wishes : current.wishes,
        },
        await this.support.today(branchId),
        { checkDate: eventDate !== current.eventDate },
      );

      if (current.venue) {
        if (details.branchId !== current.branchId || details.isOffsite) {
          throw new ValidationError('banquet.venue_hold_exists', 'Release the venue before changing the branch or switching to offsite');
        }
        if (details.eventDate !== current.eventDate || details.guests !== current.guests) {
          const moved = await this.shiftVenue(current.venue, current.eventDate, details.eventDate, branchId);
          await this.venues.moveBanquetHold(current.venue.reservationId, { ...moved, guests: details.guests });
          request.setVenue({ ...current.venue, start: moved.start, end: moved.end });
        }
      }

      if (input.contact) {
        const contact = normalizeContact(input.contact);
        let customerId = current.contact.customerId;
        if (contact.phone !== current.contact.phone || !customerId) {
          customerId = (await this.customers.identify({ phone: contact.phone, name: contact.name, email: contact.email, locale: current.locale }))
            .customerId;
          await this.customers.addTag(customerId, CustomerTag.Banquet);
        }
        request.updateContact({ customerId, ...contact });
      }
      if (input.companyId !== undefined) {
        if (input.companyId && !(await this.companies.findById(input.companyId))) {
          throw new ValidationError('banquet_company.not_found', 'Company not found', { companyId: input.companyId });
        }
        request.setCompany(input.companyId);
      }
      request.updateDetails(details);
      await this.requests.save(request);
      const after = request.auditView();
      const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
      const now = this.clock.now();
      await this.activities.add({ requestId: id, kind: 'details_updated', data: { changed }, actor, at: now });
      await this.audit.record({
        action: 'banquet.request_updated',
        entityType: 'banquet_request',
        entityId: id,
        branchId: request.branchId,
        before,
        after,
        meta: { number: request.number, changed },
        actor,
      });
      return request;
    });
  }

  /** Занятость зала на новой дате: то же локальное время начала, та же длительность. */
  private async shiftVenue(venue: BanquetVenueHold, fromDate: string, toDate: string, branchId: string | null) {
    if (fromDate === toDate) return { venueId: venue.venueId, start: venue.start, end: venue.end };
    const tz = await this.support.timezoneOf(branchId);
    const startDate = toLocalDate(venue.start, tz);
    const shiftDays = Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
    const start = zonedTimeToUtc(addDays(startDate, shiftDays), toLocalTime(venue.start, tz), tz);
    const end = new Date(start.getTime() + (venue.end.getTime() - venue.start.getTime()));
    return { venueId: venue.venueId, start, end };
  }
}

/**
 * Отмена заявки: освобождение зала в модуле Reservation, отмена неоплаченных счетов и онлайн-платежей.
 * Возврат полученной предоплаты — отдельное действие с правом payments.refund (финансы, собственник).
 */
@Injectable()
export class CancelBanquetRequest {
  constructor(
    private readonly requests: RequestRepository,
    private readonly invoices: InvoiceRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly recorder: BanquetStatusRecorder,
    private readonly venues: VenueAvailability,
    private readonly payments: PaymentsService,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string, reason: string): Promise<BanquetRequest> {
    const text = reason.trim();
    if (!text) throw new ValidationError('banquet.cancel_reason_required', 'Cancellation reason is required');
    if (text.length > 1000) throw new ValidationError('banquet.cancel_reason_too_long', 'Reason is too long');
    return this.database.transaction(async () => {
      const request = await this.support.load(id, { forUpdate: true });
      assertCanManage(actor, request);
      const before = request.auditView();
      const now = this.clock.now();
      request.transition('cancelled', now, text);
      request.markResponded(now);
      const venue = request.snapshot().venue;
      if (venue) {
        await this.venues.releaseBanquetHold(venue.reservationId, `Банкетная заявка ${request.number} отменена: ${text}`);
        request.setVenue(null);
        await this.activities.add({ requestId: id, kind: 'venue_released', data: { venueId: venue.venueId }, actor, at: now });
      }
      for (const record of await this.invoices.listForRequest(id)) {
        if (record.status !== 'issued' || record.paid.isPositive()) continue;
        const invoice = invoiceEntity((await this.invoices.findById(record.id, { forUpdate: true }))!);
        invoice.cancel(now);
        await this.invoices.saveState(invoice, { cancelReason: `Заявка отменена: ${text}` });
        if (record.paymentId) await this.payments.cancelPayment(record.paymentId, `Банкетная заявка ${request.number} отменена`);
        await this.activities.add({ requestId: id, kind: 'invoice_cancelled', data: { invoiceId: record.id, number: record.number }, actor, at: now });
        await this.audit.record({
          action: 'banquet.invoice_cancelled',
          entityType: 'banquet_invoice',
          entityId: record.id,
          branchId: request.branchId,
          before: { status: record.status },
          after: { status: 'cancelled' },
          meta: { number: record.number, requestNumber: request.number, reason: text },
          actor,
        });
      }
      await this.requests.save(request);
      await this.recorder.record(request, { actor, before });
      return request;
    });
  }
}

/**
 * Смена статуса из админки по автомату воронки. quote_sent — отправка последней версии сметы,
 * cancelled — отмена со всеми последствиями; agreed — клиент согласовал отправленную смету по телефону;
 * prepaid — только если предоплата получена; held — не раньше даты мероприятия.
 */
@Injectable()
export class TransitionBanquetRequest {
  constructor(
    private readonly requests: RequestRepository,
    private readonly quotes: QuoteRepository,
    private readonly support: BanquetSupport,
    private readonly funnel: BanquetFunnel,
    private readonly recorder: BanquetStatusRecorder,
    private readonly cancelRequest: CancelBanquetRequest,
    private readonly sendQuote: SendQuote,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string, input: { to: BanquetStatus; reason?: string | null }): Promise<BanquetRequest> {
    if (input.to === 'cancelled') return this.cancelRequest.execute(actor, id, input.reason ?? '');
    if (input.to === 'quote_sent') {
      const latest = await this.quotes.latest(id);
      if (!latest) throw new ValidationError('banquet_quote.not_found', 'Save a quote before sending it');
      return this.sendQuote.execute(actor, latest.id);
    }
    return this.database.transaction(async () => {
      const request = await this.support.load(id, { forUpdate: true });
      assertCanManage(actor, request);
      const before = request.auditView();
      const now = this.clock.now();
      const reason = input.reason?.trim() || null;
      switch (input.to) {
        case 'agreed': {
          request.assertOpen();
          const latest = await this.quotes.latest(id);
          if (request.status !== 'quote_sent' || !latest || !latest.sentAt) {
            throw new ConflictError('banquet_quote.not_awaiting_acceptance', 'The latest quote version must be sent before agreement', {
              status: request.status,
            });
          }
          await this.funnel.agree(request, latest, actor, now);
          await this.funnel.settlePrepayment(request, now);
          break;
        }
        case 'prepaid': {
          // Не из agreed — недопустимый переход (409); из agreed — только если предоплата действительно получена.
          if (request.status !== 'agreed') {
            request.transition('prepaid', now, reason);
          } else if (!(await this.funnel.settlePrepayment(request, now))) {
            throw new ValidationError('banquet.prepayment_not_received', 'Prepayment has not been received yet');
          }
          break;
        }
        case 'held': {
          const today = await this.support.today(request.branchId);
          if (request.snapshot().eventDate > today && request.canTransition('held')) {
            throw new ValidationError('banquet.event_not_yet_held', 'The event date has not come yet', { eventDate: request.snapshot().eventDate });
          }
          request.transition('held', now, reason);
          break;
        }
        default:
          request.transition(input.to, now, reason);
      }
      request.markResponded(now);
      await this.requests.save(request);
      await this.recorder.record(request, { actor, before });
      return request;
    });
  }
}

/** Переназначение ответственного менеджера (banquets.manage): событие RequestAssigned и уведомление новому менеджеру. */
@Injectable()
export class AssignBanquetManager {
  constructor(
    private readonly requests: RequestRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly assigner: ManagerAssigner,
    private readonly notifier: Notifier,
    private readonly links: BanquetLinks,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string, managerId: string): Promise<BanquetRequest> {
    return this.database.transaction(async () => {
      const request = await this.support.load(id, { forUpdate: true });
      assertCanManage(actor, request);
      request.assertOpen();
      const manager = await this.assigner.validate(managerId);
      if (request.managerId === manager.id) return request;
      const now = this.clock.now();
      const previous = request.assign(manager.id, now);
      await this.requests.save(request);
      await this.activities.add({
        requestId: id,
        kind: 'assigned',
        data: { managerId: manager.id, managerName: manager.name, previousManagerId: previous },
        actor,
        at: now,
      });
      await this.audit.record({
        action: 'banquet.manager_assigned',
        entityType: 'banquet_request',
        entityId: id,
        branchId: request.branchId,
        before: { managerId: previous },
        after: { managerId: manager.id },
        meta: { number: request.number },
        actor,
      });
      await this.events.publish(BanquetEvents.RequestAssigned, requestAssignedPayload(request, previous, now), {
        aggregateId: id,
        branchId: request.branchId,
      });
      await this.notifier.notifyStaff({
        audience: { branchId: request.branchId, userIds: [manager.id] },
        template: 'staff.banquet_assigned',
        params: { number: request.number, eventDate: formatDateRu(request.snapshot().eventDate), adminUrl: this.links.admin(id) },
        dedupeKey: `banquet:${id}:assigned:${manager.id}:${now.getTime()}`,
        related: { type: 'banquet_request', id },
      });
      return request;
    });
  }
}

/**
 * Запись в ленте заявки: заметка, звонок, контакт, встреча. Звонок / контакт / встреча — ответ гостю:
 * фиксируется время первого ответа (SLA 30 минут).
 */
@Injectable()
export class AddBanquetActivity {
  constructor(
    private readonly requests: RequestRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string, input: { kind: ManualActivityKind; text?: string | null }): Promise<string> {
    if (!(MANUAL_ACTIVITY_KINDS as readonly string[]).includes(input.kind)) {
      throw new ValidationError('banquet.activity_kind_invalid', 'Unknown activity kind', { allowed: MANUAL_ACTIVITY_KINDS });
    }
    const text = input.text?.trim() || null;
    if (input.kind === 'note' && !text) throw new ValidationError('banquet.activity_text_required', 'Note text is required');
    if (text && text.length > 4000) throw new ValidationError('banquet.activity_text_too_long', 'Text is too long');
    return this.database.transaction(async () => {
      const request = await this.support.load(id, { forUpdate: true });
      assertCanManage(actor, request);
      const now = this.clock.now();
      if (RESPONSE_ACTIVITY_KINDS.includes(input.kind) && request.markResponded(now)) {
        await this.requests.save(request);
      }
      return this.activities.add({ requestId: id, kind: input.kind, text, actor, at: now });
    });
  }
}

/**
 * Сумма предоплаты (по умолчанию 50% согласованной сметы; менеджер может изменить, null — вернуть расчёт).
 * Если уже оплачено не меньше новой суммы — заявка переходит agreed → prepaid.
 */
@Injectable()
export class SetPrepaymentAmount {
  constructor(
    private readonly requests: RequestRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly funnel: BanquetFunnel,
    private readonly recorder: BanquetStatusRecorder,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string, amount: Money | null): Promise<BanquetRequest> {
    return this.database.transaction(async () => {
      const request = await this.support.load(id, { forUpdate: true });
      assertCanManage(actor, request);
      request.assertOpen();
      const quote = await this.support.currentQuote(id);
      if (amount && quote && amount.greaterThan(quote.totals.total)) {
        throw new ValidationError('banquet.prepayment_exceeds_quote', 'Prepayment cannot exceed the quote total', {
          quoteTotal: quote.totals.total.toJSON(),
        });
      }
      const before = request.auditView();
      const now = this.clock.now();
      request.setPrepayment(amount);
      if (!amount && quote && request.status !== 'new' && request.status !== 'in_progress') request.applyDefaultPrepayment(quote.totals.total);
      await this.funnel.settlePrepayment(request, now);
      await this.requests.save(request);
      const required = request.requiredPrepayment(quote?.totals.total ?? null);
      await this.activities.add({
        requestId: id,
        kind: 'prepayment_set',
        data: { amount: required?.toJSON() ?? null, custom: amount !== null },
        actor,
        at: now,
      });
      await this.audit.record({
        action: 'banquet.prepayment_changed',
        entityType: 'banquet_request',
        entityId: id,
        branchId: request.branchId,
        before: { prepaymentAmount: before.prepaymentAmount, prepaymentIsCustom: before.prepaymentIsCustom },
        after: { prepaymentAmount: required?.toJSON() ?? null, prepaymentIsCustom: amount !== null },
        meta: { number: request.number },
        actor,
      });
      await this.recorder.record(request, { actor, before });
      return request;
    });
  }
}
