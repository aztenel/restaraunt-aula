import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { addDays, isIsoDate } from '../../../shared/kernel/time';
import { Translatable } from '../../../shared/kernel/translatable';
import { MenuQuery } from '../../catalog/public';
import { Notifier } from '../../notifications/public';
import { QUOTE_EDITABLE_STATUSES } from '../domain/banquet-status';
import { BanquetRequest } from '../domain/banquet-request';
import { formatTenge } from '../domain/money-format';
import { calculateQuote, QuoteCalculation, QuoteDiscount, QuoteLineInput } from '../domain/quote';
import { SellerSnapshot } from '../domain/requisites';
import { QuoteLineKind } from '../domain/texts';
import { ActivityRepository } from '../infrastructure/activity.repository';
import { QuoteRecord, QuoteRepository } from '../infrastructure/quote.repository';
import { RequestRepository } from '../infrastructure/request.repository';
import { assertCanManage, guestActor } from './access';
import { BanquetLinks } from './banquet-links';
import { BanquetSupport } from './banquet-support';
import { BanquetFunnel } from './funnel';
import { BanquetStatusRecorder } from './status-recorder';

/** Срок действия сметы по умолчанию, дней. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 14;

export interface QuoteLineCommand {
  kind: QuoteLineKind;
  /** Позиция меню: блюдо (название и цена филиала — снимок на момент добавления). */
  dishId?: string | null;
  /** Произвольная позиция: название, единица, цена. */
  title?: Translatable | null;
  unit?: string | null;
  unitPrice?: Money | null;
  quantity: number;
  discount?: QuoteDiscount;
}

export interface SaveQuoteInput {
  lines: QuoteLineCommand[];
  discount?: QuoteDiscount;
  serviceChargeBp?: number;
  /** Гостей в расчёте «на гостя» (по умолчанию — из заявки). */
  guests?: number | null;
  validUntil?: string | null;
  notes?: string | null;
  /** Обновить цены и названия позиций меню по текущему меню филиала (иначе — снимок из прошлой версии). */
  refreshMenuPrices?: boolean;
}

/** Расчёт сметы без сохранения: позиции (снимки меню), НДС продавца, итоги, срок действия. */
export interface PreparedQuote {
  lines: QuoteLineInput[];
  calc: QuoteCalculation;
  seller: SellerSnapshot;
  guests: number;
  validUntil: string;
  notes: string | null;
}

/**
 * Расчёт сметы по правилам сохранения (общий для сохранения версии и предпросмотра): позиции меню —
 * снимок из прошлой версии или текущее меню филиала, НДС по юрлицу-продавцу, валидация срока и заметок.
 */
@Injectable()
export class QuoteCalculator {
  constructor(
    private readonly quotes: QuoteRepository,
    private readonly support: BanquetSupport,
    private readonly menu: MenuQuery,
  ) {}

  async prepare(request: BanquetRequest, input: SaveQuoteInput): Promise<PreparedQuote> {
    const s = request.snapshot();
    const today = await this.support.today(s.branchId);
    const lines = await this.resolveLines(request, input);
    const seller = await this.support.seller(s.branchId);
    const guests = input.guests ?? s.guests;
    const calc = calculateQuote({
      lines,
      discount: input.discount ?? null,
      serviceChargeBp: input.serviceChargeBp ?? 0,
      vat: { payer: seller.vatPayer, rateBp: seller.vatRateBp },
      guests,
    });
    const validUntil = input.validUntil ?? addDays(today, DEFAULT_QUOTE_VALIDITY_DAYS);
    if (!isIsoDate(validUntil) || validUntil < today) {
      throw new ValidationError('banquet_quote.invalid_valid_until', 'Validity date must be today or later');
    }
    const notes = input.notes?.trim() || null;
    if (notes && notes.length > 4000) throw new ValidationError('banquet_quote.notes_too_long', 'Notes are too long');
    return { lines, calc, seller, guests, validUntil, notes };
  }

  private async resolveLines(request: BanquetRequest, input: SaveQuoteInput): Promise<QuoteLineInput[]> {
    const menuLines = input.lines.filter((l) => l.kind === 'menu');
    const branchId = request.branchId;
    if (menuLines.length > 0 && !branchId) {
      throw new ValidationError('banquet_quote.branch_required', 'Choose the executing branch before adding menu items');
    }
    // Снимки из последней версии: цена позиции меню фиксируется на момент добавления.
    const previous = input.refreshMenuPrices ? null : await this.quotes.latest(request.id);
    const snapshots = new Map((previous?.lines ?? []).filter((l) => l.kind === 'menu' && l.dishId).map((l) => [l.dishId!, l]));
    const missing = [...new Set(menuLines.map((l) => l.dishId).filter((id): id is string => !!id && !snapshots.has(id)))];
    const dishes = missing.length > 0 && branchId ? await this.menu.getDishes(branchId, missing) : [];
    const fresh = new Map(dishes.map((d) => [d.dishId, d]));
    return input.lines.map((line, index) => {
      if (line.kind === 'menu') {
        if (!line.dishId) throw new ValidationError('banquet_quote.dish_required', 'Menu line needs a dish', { line: index + 1 });
        const snap = snapshots.get(line.dishId);
        const dish = fresh.get(line.dishId);
        if (!snap && !dish) {
          throw new ValidationError('banquet_quote.dish_not_in_menu', 'Dish is not in the branch menu', { line: index + 1, dishId: line.dishId });
        }
        return {
          kind: 'menu',
          dishId: line.dishId,
          title: snap?.title ?? dish!.name,
          unit: line.unit?.trim() || snap?.unit || 'порц.',
          quantity: line.quantity,
          unitPrice: snap?.unitPrice ?? dish!.price,
          discount: line.discount ?? null,
        };
      }
      if (!line.unitPrice) throw new ValidationError('banquet_quote.invalid_price', 'Price is required', { line: index + 1 });
      return {
        kind: line.kind,
        dishId: null,
        title: line.title ?? {},
        unit: line.unit ?? '',
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount ?? null,
      };
    });
  }
}

/** Предпросмотр сметы: итоги по тем же правилам, что и при сохранении, без новой версии и без записи в БД. */
@Injectable()
export class PreviewQuote {
  constructor(
    private readonly support: BanquetSupport,
    private readonly calculator: QuoteCalculator,
  ) {}

  async execute(actor: Actor, requestId: string, input: SaveQuoteInput): Promise<PreparedQuote & { request: BanquetRequest; discount: QuoteDiscount; serviceChargeBp: number }> {
    const request = await this.support.load(requestId);
    assertCanManage(actor, request);
    const prepared = await this.calculator.prepare(request, input);
    return { ...prepared, request, discount: input.discount ?? null, serviceChargeBp: input.serviceChargeBp ?? 0 };
  }
}

/**
 * Сохранение сметы — всегда новая версия (прошлые версии неизменяемы и доступны списком).
 * Позиции меню — снимок названия и цены филиала на момент добавления: блюдо, уже бывшее в прошлой версии,
 * сохраняет свою цену; новое блюдо берётся из текущего меню филиала (MenuQuery).
 * НДС — по юрлицу-продавцу филиала: если плательщик НДС, НДС включён в цены и выделяется из итога.
 * Первая смета по новой заявке берёт её в работу (первый ответ менеджера).
 */
@Injectable()
export class SaveQuoteVersion {
  constructor(
    private readonly requests: RequestRepository,
    private readonly quotes: QuoteRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly recorder: BanquetStatusRecorder,
    private readonly calculator: QuoteCalculator,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, requestId: string, input: SaveQuoteInput): Promise<QuoteRecord> {
    return this.database.transaction(async () => {
      const request = await this.support.load(requestId, { forUpdate: true });
      assertCanManage(actor, request);
      if (!QUOTE_EDITABLE_STATUSES.includes(request.status)) {
        throw new ConflictError('banquet_quote.not_editable', `Quote cannot be changed in status ${request.status}`, { status: request.status });
      }
      const s = request.snapshot();
      const now = this.clock.now();
      const { calc, seller, guests, validUntil, notes } = await this.calculator.prepare(request, input);
      const quote = {
        id: newId(),
        requestId,
        version: await this.quotes.nextVersion(requestId),
        branchId: s.branchId,
        guests,
        discount: input.discount ?? null,
        serviceChargeBp: input.serviceChargeBp ?? 0,
        vat: { payer: seller.vatPayer, rateBp: seller.vatRateBp },
        lines: calc.lines,
        totals: calc.totals,
        validUntil,
        notes,
        seller,
        createdBy: actor.userId,
        createdByName: actor.name,
        createdAt: now,
      };
      await this.quotes.insert(quote);
      const before = request.auditView();
      if (request.status === 'new') request.transition('in_progress', now, 'Составлена смета');
      request.markResponded(now);
      await this.requests.save(request);
      await this.activities.add({
        requestId,
        kind: 'quote_saved',
        data: { quoteId: quote.id, version: quote.version, total: calc.totals.total.toJSON() },
        actor,
        at: now,
      });
      await this.audit.record({
        action: 'banquet.quote_saved',
        entityType: 'banquet_quote',
        entityId: quote.id,
        branchId: s.branchId,
        after: {
          version: quote.version,
          lines: calc.lines.length,
          subtotal: calc.totals.subtotal.toJSON(),
          discount: calc.totals.discount.toJSON(),
          service: calc.totals.service.toJSON(),
          total: calc.totals.total.toJSON(),
          vat: calc.totals.vat.toJSON(),
        },
        meta: { requestId, number: s.number },
        actor,
      });
      await this.recorder.record(request, { actor, before });
      return (await this.quotes.findById(quote.id))!;
    });
  }
}

/**
 * Отправка сметы клиенту: последняя версия, статус → quote_sent (из in_progress или agreed — новая версия
 * после согласования), уведомление со ссылкой на страницу сметы (PDF и кнопка «Согласовать»).
 * Повторная отправка в статусе quote_sent — только новой версии, без смены статуса.
 */
@Injectable()
export class SendQuote {
  constructor(
    private readonly requests: RequestRepository,
    private readonly quotes: QuoteRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly recorder: BanquetStatusRecorder,
    private readonly notifier: Notifier,
    private readonly links: BanquetLinks,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, quoteId: string): Promise<BanquetRequest> {
    const found = await this.quotes.findById(quoteId);
    if (!found) throw new NotFoundError('banquet_quote', quoteId);
    return this.database.transaction(async () => {
      const request = await this.support.load(found.requestId, { forUpdate: true });
      assertCanManage(actor, request);
      if (!QUOTE_EDITABLE_STATUSES.includes(request.status)) {
        throw new ConflictError('banquet_quote.not_editable', `Quote cannot be sent in status ${request.status}`, { status: request.status });
      }
      const latest = await this.quotes.latest(request.id);
      if (!latest || latest.id !== found.id) {
        throw new ConflictError('banquet_quote.outdated', 'Only the latest quote version can be sent', { latestVersion: latest?.version ?? null });
      }
      // После согласования отправляется только новая версия (agreed → quote_sent), повтор той же — не нужен.
      if ((request.status === 'quote_sent' || request.status === 'agreed') && found.sentAt) {
        throw new ConflictError('banquet_quote.already_sent', 'This version has already been sent', { version: found.version });
      }
      const before = request.auditView();
      const now = this.clock.now();
      if (request.status === 'new') request.transition('in_progress', now);
      if (request.status !== 'quote_sent') request.transition('quote_sent', now);
      request.markResponded(now);
      await this.quotes.markSent(found.id, now);
      await this.requests.save(request);
      const s = request.snapshot();
      const manager = await this.support.manager(s.managerId);
      await this.activities.add({
        requestId: s.id,
        kind: 'quote_sent',
        data: { quoteId: found.id, version: found.version, total: found.totals.total.toJSON() },
        actor,
        at: now,
      });
      await this.audit.record({
        action: 'banquet.quote_sent',
        entityType: 'banquet_quote',
        entityId: found.id,
        branchId: s.branchId,
        after: { version: found.version, total: found.totals.total.toJSON(), sentAt: now.toISOString() },
        meta: { requestId: s.id, number: s.number },
        actor,
      });
      await this.recorder.record(request, { actor, before });
      await this.notifier.notifyGuest({
        recipient: { phone: s.contact.phone || null, email: s.contact.email, name: s.contact.name },
        template: 'banquet.quote_sent',
        params: {
          number: s.number,
          quoteUrl: this.links.quote(s.publicToken, s.locale),
          total: formatTenge(found.totals.total),
          managerName: manager.name,
        },
        locale: s.locale,
        dedupeKey: `banquet:${s.id}:quote:${found.version}`,
        related: { type: 'banquet_request', id: s.id },
      });
      return request;
    });
  }
}

/**
 * Клиент согласовывает смету по ссылке: только из quote_sent и только последнюю (отправленную) версию,
 * пока смета действует. → agreed, предоплата по умолчанию 50% итога. Повтор согласования той же версии — без изменений.
 */
@Injectable()
export class AcceptQuote {
  constructor(
    private readonly requests: RequestRepository,
    private readonly quotes: QuoteRepository,
    private readonly support: BanquetSupport,
    private readonly funnel: BanquetFunnel,
    private readonly recorder: BanquetStatusRecorder,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(token: string, input: { version: number }): Promise<{ request: BanquetRequest; quote: QuoteRecord }> {
    const found = await this.requests.findByToken(token);
    if (!found) throw new NotFoundError('banquet_quote');
    return this.database.transaction(async () => {
      const request = await this.support.load(found.id, { forUpdate: true });
      const s = request.snapshot();
      const actor = guestActor(s.contact.name);
      const accepted = await this.quotes.latestAccepted(s.id);
      if (request.status !== 'quote_sent') {
        if (accepted && accepted.version === input.version && ['agreed', 'prepaid', 'held'].includes(request.status)) {
          return { request, quote: accepted };
        }
        throw new ConflictError('banquet_quote.not_awaiting_acceptance', 'Quote is not awaiting acceptance', { status: request.status });
      }
      const latest = await this.quotes.latest(s.id);
      if (!latest || !latest.sentAt || latest.version !== input.version) {
        throw new ConflictError('banquet_quote.outdated', 'Only the latest sent quote version can be accepted', {
          latestVersion: latest?.sentAt ? latest.version : null,
        });
      }
      const today = await this.support.today(s.branchId);
      if (latest.validUntil && latest.validUntil < today) {
        throw new ValidationError('banquet_quote.expired', 'Quote has expired, please contact the manager', { validUntil: latest.validUntil });
      }
      const before = request.auditView();
      const now = this.clock.now();
      await this.funnel.agree(request, latest, actor, now);
      await this.funnel.settlePrepayment(request, now);
      await this.requests.save(request);
      await this.audit.record({
        action: 'banquet.quote_accepted',
        entityType: 'banquet_quote',
        entityId: latest.id,
        branchId: s.branchId,
        after: { version: latest.version, total: latest.totals.total.toJSON(), acceptedAt: now.toISOString() },
        meta: { requestId: s.id, number: s.number },
        actor,
      });
      await this.recorder.record(request, { actor, before });
      return { request, quote: (await this.quotes.findById(latest.id))! };
    });
  }
}
