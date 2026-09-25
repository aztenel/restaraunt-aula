/**
 * Заглушки публичных контрактов модулей для интеграционных тестов отдельного модуля.
 * Модуль под тестом подключается по-настоящему, соседние — этими фейками:
 *
 *   createTestApp({ imports: [OrderingModule], providers: fakeProviders({ except: [OrderQuery] }) })
 *
 * Каждый фейк записывает вызовы (calls) и позволяет настроить ответы.
 */
import { Provider } from '@nestjs/common';
import { Money } from '../../src/shared/kernel/money';
import { newId } from '../../src/shared/kernel/ids';
import { ConflictError, NotFoundError, ValidationError } from '../../src/shared/kernel/errors';
import { normalizePhone } from '../../src/shared/kernel/phone';
import { Locale } from '../../src/shared/kernel/translatable';
import { HttpTransport } from '../../src/shared/infrastructure/integrations/external-http';
import {
  BranchOrderMenu,
  DishAvailability,
  DishCard,
  DishSummary,
  MenuPricing,
  MenuQuery,
  OrderMenuModifierGroup,
  PricedLine,
  PricedLineRequest,
  StopListControl,
} from '../../src/modules/catalog/public';
import {
  ConsentKind,
  CustomerDirectory,
  CustomerProfile,
  PhoneVerification,
} from '../../src/modules/customers/public';
import { AdminFeed, AdminFeedEvent, Notifier } from '../../src/modules/notifications/public';
import { KitchenOrder, OrderQuery } from '../../src/modules/ordering/public';
import {
  CertificateBalanceView,
  CreatePaymentCommand,
  GiftCertificates,
  PaymentPurpose,
  PaymentsService,
  PaymentView,
  RefundView,
} from '../../src/modules/payments/public';
import { VenueAvailability, VenueOccupancy, VenueSummary } from '../../src/modules/reservation/public';

// ---------------------------------------------------------------- Notifications

export class FakeNotifier extends Notifier {
  guest: Array<{ template: string; recipient: unknown; params: unknown; locale: Locale; dedupeKey?: string }> = [];
  staff: Array<{ template: string; audience: unknown; params: unknown }> = [];

  async notifyGuest(input: any): Promise<void> {
    this.guest.push({ template: input.template, recipient: input.recipient, params: input.params, locale: input.locale, dedupeKey: input.dedupeKey });
  }

  async notifyStaff(input: any): Promise<void> {
    this.staff.push({ template: input.template, audience: input.audience, params: input.params });
  }

  templates(): string[] {
    return [...this.guest.map((g) => g.template), ...this.staff.map((s) => s.template)];
  }

  clear(): void {
    this.guest = [];
    this.staff = [];
  }
}

export class FakeAdminFeed extends AdminFeed {
  events: AdminFeedEvent[] = [];
  async push(event: AdminFeedEvent): Promise<void> {
    this.events.push(event);
  }
}

// ---------------------------------------------------------------- Customers

export class FakeCustomerDirectory extends CustomerDirectory {
  customers = new Map<string, CustomerProfile>();
  consents: Array<{ customerId: string; kind: ConsentKind; granted: boolean; textVersion: string }> = [];

  async identify(input: { phone: string; name?: string | null; email?: string | null; locale?: Locale }) {
    const phone = normalizePhone(input.phone);
    const existing = [...this.customers.values()].find((c) => c.phone === phone);
    if (existing) {
      existing.name ??= input.name ?? null;
      existing.email ??= input.email ?? null;
      return { customerId: existing.id, isNew: false };
    }
    const id = newId();
    this.customers.set(id, {
      id,
      phone,
      name: input.name ?? null,
      email: input.email ?? null,
      locale: input.locale ?? 'ru',
      tags: [],
      allergies: null,
      preferences: null,
      personalDataConsent: false,
      marketingConsent: false,
    });
    return { customerId: id, isNew: true };
  }

  async get(customerId: string): Promise<CustomerProfile> {
    const c = this.customers.get(customerId);
    if (!c) throw new NotFoundError('customer', customerId);
    return c;
  }

  async findByPhone(phone: string): Promise<CustomerProfile | null> {
    const p = normalizePhone(phone);
    return [...this.customers.values()].find((c) => c.phone === p) ?? null;
  }

  async recordConsent(input: { customerId: string; kind: ConsentKind; granted: boolean; textVersion: string }): Promise<void> {
    this.consents.push(input);
    const c = this.customers.get(input.customerId);
    if (c && input.kind === 'personal_data') c.personalDataConsent = input.granted;
    if (c && input.kind === 'marketing') c.marketingConsent = input.granted;
  }

  async currentConsentVersion(): Promise<string> {
    return '2026-09-25';
  }

  async addTag(customerId: string, tag: string): Promise<void> {
    const c = this.customers.get(customerId);
    if (c && !c.tags.includes(tag)) c.tags.push(tag);
  }
}

/** Код всегда '1234'; токен — 'verified:<phone>'. */
export class FakePhoneVerification extends PhoneVerification {
  started: string[] = [];

  async start(phone: string) {
    const p = normalizePhone(phone);
    this.started.push(p);
    return { verificationId: `v:${p}`, expiresAt: new Date(Date.now() + 300_000), resendAfterSeconds: 60 };
  }

  async verify(verificationId: string, code: string) {
    if (code !== '1234') throw new ValidationError('phone.code_invalid', 'Invalid code');
    const phone = verificationId.slice(2);
    return { token: `verified:${phone}`, phone };
  }

  async assertVerified(phone: string, token: string | null | undefined): Promise<void> {
    if (token !== `verified:${normalizePhone(phone)}`) {
      throw new ValidationError('phone.not_verified', 'Phone is not verified');
    }
  }
}

// ---------------------------------------------------------------- Catalog

export interface FakeDish {
  dishId: string;
  name: string;
  price: number;
  categoryId?: string;
  availability?: DishAvailability;
  branchIds?: string[];
  sku?: string | null;
  modifiers?: Array<{ groupId: string; optionId: string; name: string; price: number }>;
}

export class FakeMenu {
  dishes = new Map<string, FakeDish>();

  add(dish: Partial<FakeDish> & { name: string; price: number }): FakeDish {
    const d: FakeDish = { dishId: dish.dishId ?? newId(), categoryId: dish.categoryId ?? 'cat-1', availability: 'available', ...dish };
    this.dishes.set(d.dishId, d);
    return d;
  }
}

export class FakeMenuPricing extends MenuPricing {
  constructor(readonly menu: FakeMenu) {
    super();
  }

  async priceLines(branchId: string, lines: PricedLineRequest[]): Promise<PricedLine[]> {
    return lines.map((line) => {
      const dish = this.menu.dishes.get(line.dishId);
      if (!dish || (dish.branchIds && !dish.branchIds.includes(branchId))) {
        throw new ValidationError('catalog.dish_not_in_branch_menu', 'Dish not in branch menu', { dishId: line.dishId });
      }
      if (dish.availability !== 'available') {
        throw new ValidationError('catalog.dish_unavailable', 'Dish unavailable', { dishId: line.dishId });
      }
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
        throw new ValidationError('catalog.quantity_invalid', 'Invalid quantity');
      }
      const modifiers = line.modifierOptionIds.map((optionId) => {
        const m = dish.modifiers?.find((x) => x.optionId === optionId);
        if (!m) throw new ValidationError('catalog.modifier_invalid', 'Invalid modifier', { optionId });
        return { groupId: m.groupId, groupName: { ru: 'Добавки' }, optionId, optionName: { ru: m.name }, price: Money.of(m.price) };
      });
      const basePrice = Money.of(dish.price);
      const unitPrice = modifiers.reduce((acc, m) => acc.add(m.price), basePrice);
      return {
        dishId: dish.dishId,
        dishSlug: dish.name.toLowerCase().replace(/\s+/g, '-'),
        dishName: { ru: dish.name, kk: dish.name },
        categoryId: dish.categoryId ?? 'cat-1',
        photoUrl: null,
        weightGrams: 300,
        quantity: line.quantity,
        basePrice,
        modifiers,
        unitPrice,
        lineTotal: unitPrice.multiply(line.quantity),
        sku: dish.sku ?? null,
      };
    });
  }

  async checkAvailability(branchId: string, dishIds: string[]) {
    const result: Record<string, DishAvailability | 'not_in_menu'> = {};
    for (const id of dishIds) {
      const d = this.menu.dishes.get(id);
      result[id] = !d || (d.branchIds && !d.branchIds.includes(branchId)) ? 'not_in_menu' : (d.availability ?? 'available');
    }
    return result;
  }
}

export class FakeMenuQuery extends MenuQuery {
  constructor(readonly menu: FakeMenu) {
    super();
  }

  private summary(d: FakeDish): DishSummary {
    return {
      dishId: d.dishId,
      slug: d.name.toLowerCase().replace(/\s+/g, '-'),
      name: { ru: d.name },
      categoryId: d.categoryId ?? 'cat-1',
      price: Money.of(d.price),
      availability: d.availability ?? 'available',
      photoUrl: null,
      weightGrams: 300,
    };
  }

  async searchBranchDishes(_branchId: string, query: string, limit = 20): Promise<DishSummary[]> {
    return [...this.menu.dishes.values()].filter((d) => d.name.toLowerCase().includes(query.toLowerCase())).slice(0, limit).map((d) => this.summary(d));
  }

  async getDishes(_branchId: string, dishIds: string[]): Promise<DishSummary[]> {
    return dishIds.map((id) => this.menu.dishes.get(id)).filter((d): d is FakeDish => !!d).map((d) => this.summary(d));
  }

  async describeDishes(dishIds: string[]): Promise<DishCard[]> {
    return dishIds
      .map((id) => this.menu.dishes.get(id))
      .filter((d): d is FakeDish => !!d)
      .map((d) => ({ dishId: d.dishId, slug: this.summary(d).slug, name: { ru: d.name, kk: d.name }, photoUrl: null, weightGrams: 300 }));
  }

  async branchOrderMenu(branchId: string): Promise<BranchOrderMenu> {
    const dishes = [...this.menu.dishes.values()].filter((d) => !d.branchIds || d.branchIds.includes(branchId));
    const categoryIds = [...new Set(dishes.map((d) => d.categoryId ?? 'cat-1'))];
    return {
      branchId,
      categories: categoryIds.map((id) => ({ id, slug: id, name: { ru: id } })),
      dishes: dishes.map((d) => {
        const groups = new Map<string, OrderMenuModifierGroup>();
        for (const m of d.modifiers ?? []) {
          const group = groups.get(m.groupId) ?? { id: m.groupId, name: { ru: 'Добавки' }, minSelect: 0, maxSelect: 10, isRequired: false, options: [] };
          group.options.push({ id: m.optionId, name: { ru: m.name }, price: Money.of(m.price), isDefault: false });
          groups.set(m.groupId, group);
        }
        const availability = d.availability ?? 'available';
        return {
          ...this.summary(d),
          availability,
          stopped: availability !== 'available',
          stoppedUntil: null,
          stopReason: null,
          sku: d.sku ?? null,
          modifierGroups: [...groups.values()],
        };
      }),
    };
  }
}

export class FakeStopListControl extends StopListControl {
  changes: Array<{ branchId: string; dishId: string; available: boolean; source: string }> = [];
  skus = new Map<string, string>();

  async setAvailability(branchId: string, dishId: string, available: boolean, source: 'manual' | 'pos'): Promise<void> {
    this.changes.push({ branchId, dishId, available, source });
  }

  async findDishIdBySku(sku: string): Promise<string | null> {
    return this.skus.get(sku) ?? null;
  }
}

// ---------------------------------------------------------------- Payments

export class FakePaymentsService extends PaymentsService {
  payments = new Map<string, PaymentView>();
  refunds: RefundView[] = [];
  byKey = new Map<string, string>();
  collected: string[] = [];

  async createPayment(cmd: CreatePaymentCommand): Promise<PaymentView> {
    const existing = this.byKey.get(cmd.idempotencyKey);
    if (existing) return this.payments.get(existing)!;
    const view: PaymentView = {
      id: newId(),
      purpose: cmd.purpose,
      referenceId: cmd.referenceId,
      branchId: cmd.branchId,
      method: cmd.method,
      provider: cmd.method === 'online' ? 'sandbox' : cmd.method,
      status: cmd.method === 'gift_certificate' ? 'succeeded' : cmd.method === 'online' ? 'created' : 'pending',
      amount: cmd.amount,
      refundedAmount: Money.zero(),
      paymentUrl: cmd.method === 'online' ? `https://pay.test/${cmd.idempotencyKey}` : null,
      externalId: null,
      createdAt: new Date(),
      paidAt: cmd.method === 'gift_certificate' ? new Date() : null,
      expiresAt: cmd.expiresAt ?? null,
    };
    this.payments.set(view.id, view);
    this.byKey.set(cmd.idempotencyKey, view.id);
    return view;
  }

  async getPayment(paymentId: string): Promise<PaymentView> {
    const p = this.payments.get(paymentId);
    if (!p) throw new NotFoundError('payment', paymentId);
    return p;
  }

  async listForReference(purpose: PaymentPurpose, referenceId: string): Promise<PaymentView[]> {
    return [...this.payments.values()].filter((p) => p.purpose === purpose && p.referenceId === referenceId);
  }

  async cancelPayment(paymentId: string): Promise<void> {
    const p = await this.getPayment(paymentId);
    if (p.status === 'created' || p.status === 'pending') p.status = 'cancelled';
  }

  async requestRefund(input: { paymentId: string; amount?: Money; reason: string; idempotencyKey: string }): Promise<RefundView> {
    const p = await this.getPayment(input.paymentId);
    const amount = input.amount ?? p.amount.subtract(p.refundedAmount);
    if (p.refundedAmount.add(amount).greaterThan(p.amount)) {
      throw new ConflictError('payment.refund_exceeds', 'Refund exceeds payment');
    }
    const refund: RefundView = { id: newId(), paymentId: p.id, amount, status: 'pending', reason: input.reason, createdAt: new Date() };
    this.refunds.push(refund);
    return refund;
  }

  async listRefunds(paymentIds: string[]): Promise<RefundView[]> {
    return this.refunds.filter((r) => paymentIds.includes(r.paymentId));
  }

  async markCollected(paymentId: string): Promise<void> {
    const p = await this.getPayment(paymentId);
    p.status = 'succeeded';
    p.paidAt = new Date();
    this.collected.push(paymentId);
  }

  async registerBankTransfer(input: {
    purpose: PaymentPurpose;
    referenceId: string;
    branchId: string | null;
    amount: Money;
    paidAt: Date;
    documentNumber: string;
    idempotencyKey: string;
  }): Promise<PaymentView> {
    const view = await this.createPayment({
      purpose: input.purpose,
      referenceId: input.referenceId,
      branchId: input.branchId,
      method: 'bank_transfer',
      amount: input.amount,
      description: input.documentNumber,
      customer: { phone: null },
      returnUrl: null,
      idempotencyKey: input.idempotencyKey,
    });
    view.status = 'succeeded';
    view.paidAt = input.paidAt;
    return view;
  }

  /** Помощник теста: отметить платёж успешным (дальше тест публикует PaymentsEvents.PaymentSucceeded). */
  succeed(paymentId: string): PaymentView {
    const p = this.payments.get(paymentId)!;
    p.status = 'succeeded';
    p.paidAt = new Date();
    return p;
  }
}

export class FakeGiftCertificates extends GiftCertificates {
  certificates = new Map<string, CertificateBalanceView>();

  add(code: string, balance: number): CertificateBalanceView {
    const view: CertificateBalanceView = {
      id: newId(),
      maskedCode: `****-****-${code.slice(-4)}`,
      kind: 'amount',
      status: 'active',
      nominal: Money.of(balance),
      balance: Money.of(balance),
      expiresAt: new Date(Date.now() + 365 * 86400_000),
      setDescription: null,
    };
    this.certificates.set(code, view);
    return view;
  }

  async check(code: string): Promise<CertificateBalanceView> {
    const c = this.certificates.get(code);
    if (!c) throw new NotFoundError('certificate');
    return c;
  }
}

// ---------------------------------------------------------------- Reservation

export class FakeVenueAvailability extends VenueAvailability {
  venues = new Map<string, VenueSummary>();
  holds = new Map<string, VenueOccupancy>();

  addVenue(branchId: string, overrides: Partial<VenueSummary> = {}): VenueSummary {
    const v: VenueSummary = {
      id: newId(),
      branchId,
      hallId: newId(),
      hallName: { ru: 'Основной зал' },
      name: { ru: 'VIP-зал' },
      typeId: newId(),
      typeCode: 'vip',
      typeName: { ru: 'VIP-зал' },
      capacityMin: 1,
      capacityMax: 40,
      deposit: { amount: 5_000_000, currency: 'KZT' },
      isActive: true,
      ...overrides,
    };
    this.venues.set(v.id, v);
    return v;
  }

  async listVenues(branchId: string) {
    return [...this.venues.values()].filter((v) => v.branchId === branchId);
  }

  async getVenue(venueId: string) {
    const v = this.venues.get(venueId);
    if (!v) throw new NotFoundError('venue', venueId);
    return v;
  }

  async isAvailable(venueId: string, start: Date, end: Date, exclude?: string | null) {
    return ![...this.holds.values()].some(
      (h) => h.venueId === venueId && h.reservationId !== exclude && new Date(h.start) < end && start < new Date(h.end),
    );
  }

  async holdForBanquet(input: { venueId: string; start: Date; end: Date; guests: number; banquetRequestId: string }) {
    const v = await this.getVenue(input.venueId);
    if (input.guests > v.capacityMax) throw new ValidationError('reservation.capacity_exceeded', 'Too many guests');
    if (!(await this.isAvailable(input.venueId, input.start, input.end))) {
      throw new ConflictError('reservation.venue_occupied', 'Venue occupied');
    }
    const id = newId();
    this.holds.set(id, {
      reservationId: id,
      venueId: input.venueId,
      kind: 'banquet',
      status: 'confirmed',
      start: input.start.toISOString(),
      end: input.end.toISOString(),
      guests: input.guests,
      banquetRequestId: input.banquetRequestId,
    });
    return { reservationId: id };
  }

  async moveBanquetHold(reservationId: string, input: { venueId: string; start: Date; end: Date; guests: number }) {
    const hold = this.holds.get(reservationId);
    if (!hold) throw new NotFoundError('reservation', reservationId);
    if (!(await this.isAvailable(input.venueId, input.start, input.end, reservationId))) {
      throw new ConflictError('reservation.venue_occupied', 'Venue occupied');
    }
    Object.assign(hold, { venueId: input.venueId, start: input.start.toISOString(), end: input.end.toISOString(), guests: input.guests });
  }

  async releaseBanquetHold(reservationId: string) {
    this.holds.delete(reservationId);
  }

  async occupancy(branchId: string, from: Date, to: Date) {
    return [...this.holds.values()].filter(
      (h) => this.venues.get(h.venueId)?.branchId === branchId && new Date(h.start) < to && from < new Date(h.end),
    );
  }
}

// ---------------------------------------------------------------- Ordering

export class FakeOrderQuery extends OrderQuery {
  orders = new Map<string, KitchenOrder>();
  async getKitchenOrder(orderId: string): Promise<KitchenOrder> {
    const o = this.orders.get(orderId);
    if (!o) throw new NotFoundError('order', orderId);
    return o;
  }
}

// ---------------------------------------------------------------- HTTP (адаптеры интеграций)

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** Подмена сети для адаптеров: очередь заготовленных ответов по подстроке URL. */
export class FakeHttpTransport extends HttpTransport {
  requests: RecordedRequest[] = [];
  private routes: Array<{ match: string | RegExp; status: number; body: unknown; headers?: Record<string, string>; times?: number }> = [];

  on(match: string | RegExp, status: number, body: unknown, options: { headers?: Record<string, string>; times?: number } = {}): this {
    this.routes.push({ match, status, body, headers: options.headers, times: options.times });
    return this;
  }

  async send(input: { method: string; url: string; headers: Record<string, string>; body?: string; timeoutMs: number }) {
    this.requests.push({ method: input.method, url: input.url, headers: input.headers, body: input.body });
    const idx = this.routes.findIndex((r) => (typeof r.match === 'string' ? input.url.includes(r.match) : r.match.test(input.url)));
    if (idx === -1) throw new Error(`FakeHttpTransport: no route for ${input.method} ${input.url}`);
    const route = this.routes[idx]!;
    if (route.times !== undefined) {
      route.times -= 1;
      if (route.times <= 0) this.routes.splice(idx, 1);
    }
    const text = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
    return {
      status: route.status,
      headers: { 'content-type': typeof route.body === 'string' ? 'text/plain' : 'application/json', ...(route.headers ?? {}) },
      text,
    };
  }
}

// ---------------------------------------------------------------- сборка

export interface Fakes {
  notifier: FakeNotifier;
  adminFeed: FakeAdminFeed;
  customers: FakeCustomerDirectory;
  phoneVerification: FakePhoneVerification;
  menu: FakeMenu;
  menuPricing: FakeMenuPricing;
  menuQuery: FakeMenuQuery;
  stopList: FakeStopListControl;
  payments: FakePaymentsService;
  certificates: FakeGiftCertificates;
  venues: FakeVenueAvailability;
  orders: FakeOrderQuery;
}

export function createFakes(): Fakes {
  const menu = new FakeMenu();
  return {
    notifier: new FakeNotifier(),
    adminFeed: new FakeAdminFeed(),
    customers: new FakeCustomerDirectory(),
    phoneVerification: new FakePhoneVerification(),
    menu,
    menuPricing: new FakeMenuPricing(menu),
    menuQuery: new FakeMenuQuery(menu),
    stopList: new FakeStopListControl(),
    payments: new FakePaymentsService(),
    certificates: new FakeGiftCertificates(),
    venues: new FakeVenueAvailability(),
    orders: new FakeOrderQuery(),
  };
}

type AbstractToken = abstract new (...args: any[]) => unknown;

/**
 * Провайдеры-заглушки всех публичных контрактов, кроме реализуемых модулем под тестом.
 * Пример: fakeProviders(fakes, { except: [MenuPricing, MenuQuery, StopListControl] }) для CatalogModule.
 */
export function fakeProviders(fakes: Fakes, options: { except?: AbstractToken[] } = {}): Provider[] {
  const all: Array<[AbstractToken, unknown]> = [
    [Notifier, fakes.notifier],
    [AdminFeed, fakes.adminFeed],
    [CustomerDirectory, fakes.customers],
    [PhoneVerification, fakes.phoneVerification],
    [MenuPricing, fakes.menuPricing],
    [MenuQuery, fakes.menuQuery],
    [StopListControl, fakes.stopList],
    [PaymentsService, fakes.payments],
    [GiftCertificates, fakes.certificates],
    [VenueAvailability, fakes.venues],
    [OrderQuery, fakes.orders],
  ];
  const except = new Set(options.except ?? []);
  return all.filter(([token]) => !except.has(token)).map(([token, value]) => ({ provide: token, useValue: value }));
}
