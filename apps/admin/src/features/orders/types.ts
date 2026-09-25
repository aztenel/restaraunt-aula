/**
 * Формы ответов модуля Ordering (apps/api/src/modules/ordering/http/dto/*.ts). В docs/openapi.json
 * nullable-поля описаны как необязательные (`field?: T | null`), а сервер всегда присылает их (null) —
 * здесь они обязательные `T | null`, поэтому ответы приводятся к этим типам; тела запросов
 * передаются в типизированный клиент без приведения. Все суммы — тиыны от сервера; фронт их только показывает.
 */
import type { GeoPoint, Money, Translatable } from '@aula/api-client';

export const ORDER_STATUSES = [
  'draft',
  'awaiting_payment',
  'paid',
  'accepted',
  'cooking',
  'ready',
  'delivering',
  'completed',
  'cancelled',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TYPES = ['delivery', 'pickup'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export type OrderChannel = 'web' | 'admin';
export type CheckoutPaymentMethod = 'online' | 'on_receipt';

/** Коды причин отмены (domain/order-status.ts CANCEL_REASON_CODES). */
export const CANCEL_REASON_CODES = ['guest_request', 'not_paid_in_time', 'out_of_stock', 'cannot_deliver', 'duplicate', 'other'] as const;
export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

export const COURIER_DISPATCH_STATUSES = [
  'requested',
  'estimating',
  'awaiting_confirmation',
  'searching',
  'courier_assigned',
  'picked_up',
  'delivered',
  'cancelled',
  'failed',
] as const;
export type CourierDispatchStatus = (typeof COURIER_DISPATCH_STATUSES)[number];

export interface OrderCustomer {
  customerId: string | null;
  name: string | null;
  phone: string;
  email: string | null;
}

export interface AdminOrderListItem {
  id: string;
  number: string;
  branchId: string;
  type: OrderType;
  channel: OrderChannel;
  status: OrderStatus;
  customer: OrderCustomer;
  total: Money;
  paymentMethod: CheckoutPaymentMethod;
  promoCode: string | null;
  placedAt: string;
  scheduledFor: string | null;
  promisedAt: string;
}

export interface AdminOrderModifier {
  groupId: string;
  groupName: Translatable;
  optionId: string;
  optionName: Translatable;
  price: Money;
}

export interface AdminOrderItem {
  id: string;
  position: number;
  dishId: string;
  sku: string | null;
  /** Снимок названия на момент заказа. */
  name: Translatable;
  photoUrl: string | null;
  weightGrams: number | null;
  quantity: number;
  basePrice: Money;
  unitPrice: Money;
  lineTotal: Money;
  modifiers: AdminOrderModifier[];
}

export interface QueueOrder extends AdminOrderListItem {
  items: AdminOrderItem[];
  comment: string | null;
  deliveryAddress: string | null;
  contactless: boolean;
  /** Переходы, доступные сотруднику (решает сервер). */
  allowedTransitions: OrderStatus[];
  /** Обещанное время прошло. */
  isLate: boolean;
}

export interface QueueGroup {
  status: OrderStatus;
  count: number;
  orders: QueueOrder[];
}

export interface OrderQueue {
  generatedAt: string;
  groups: QueueGroup[];
}

export interface AdminOrderDelivery {
  point: GeoPoint;
  addressText: string;
  apartment: string | null;
  entrance: string | null;
  floor: string | null;
  intercom: string | null;
  courierComment: string | null;
  zoneId: string | null;
  zoneName: Translatable | null;
  contactless: boolean;
}

export type OrderPaymentKind = 'certificate' | 'online' | 'on_receipt';
export type PaymentMethodCode = 'online' | 'on_receipt' | 'gift_certificate' | 'bank_transfer';
export type PaymentStatusCode = 'created' | 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'partially_refunded' | 'refunded';

export interface AdminOrderPayment {
  id: string;
  kind: OrderPaymentKind | null;
  attempt: number | null;
  method: PaymentMethodCode;
  provider: string;
  status: PaymentStatusCode;
  amount: Money;
  refundedAmount: Money;
  paymentUrl: string | null;
  createdAt: string;
  paidAt: string | null;
}

export type RefundKind = 'cancellation' | 'partial' | 'late_payment' | 'duplicate_payment' | 'external';

export interface AdminOrderRefund {
  refundId: string;
  paymentId: string;
  kind: RefundKind;
  status: 'pending' | 'succeeded' | 'failed';
  amount: Money;
  reason: string;
  requestedBy: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AdminCourierDispatch {
  id: string;
  provider: string;
  status: CourierDispatchStatus;
  providerStatus: string | null;
  externalId: string | null;
  trackingUrl: string | null;
  courierName: string | null;
  courierPhone: string | null;
  price: Money | null;
  attempts: number;
  lastError: string | null;
  requestedAt: string;
  finishedAt: string | null;
}

export interface OrderStatusHistoryEntry {
  from: OrderStatus | null;
  to: OrderStatus;
  at: string;
  actorKind: 'staff' | 'system' | 'guest';
  actorName: string;
  actorUserId: string | null;
  reasonCode: string | null;
  reason: string | null;
}

export interface OrderTimestamps {
  placedAt: string;
  paidAt: string | null;
  acceptedAt: string | null;
  cookingAt: string | null;
  readyAt: string | null;
  deliveringAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
}

export interface AdminOrderDetails extends AdminOrderListItem {
  publicToken: string;
  locale: 'kk' | 'ru' | 'en';
  items: AdminOrderItem[];
  subtotal: Money;
  discount: Money;
  deliveryFee: Money;
  promoKind: PromoKind | null;
  certificateMaskedCode: string | null;
  certificateAmount: Money;
  /** К оплате онлайн / при получении. */
  amountDue: Money;
  delivery: AdminOrderDelivery | null;
  comment: string | null;
  etaMinutes: number;
  analyticsSessionId: string | null;
  createdBy: string | null;
  wasPaid: boolean;
  cancellation: { reasonCode: CancelReasonCode; reason: string | null } | null;
  timestamps: OrderTimestamps;
  payments: AdminOrderPayment[];
  refunds: AdminOrderRefund[];
  courierDispatch: AdminCourierDispatch | null;
  history: OrderStatusHistoryEntry[];
  allowedTransitions: OrderStatus[];
  canCancel: boolean;
  /** Отказ от оплаченного заказа (paid → accepted → cancelled). */
  canReject: boolean;
  /** Частичный возврат (право orders.refund, статус от принятия до выполнения). */
  canRefund: boolean;
  /** Сколько ещё можно вернуть (считает сервер). */
  refundable: Money;
  trackingUrl: string;
}

export type PromoKind = 'percent' | 'fixed' | 'free_delivery';

// ---------------------------------------------------------------- Запросы

export interface OrdersListQuery {
  branchId?: string;
  status?: OrderStatus[];
  type?: OrderType;
  /** YYYY-MM-DD (Asia/Almaty), включительно. */
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  page?: number;
  perPage?: number;
}

export interface MoneyInput {
  amount: number;
  currency: 'KZT';
}

export interface CancelOrderInput {
  reasonCode: CancelReasonCode;
  reason?: string | null;
  /** Частичная сумма возврата (право orders.refund); не задана — полный возврат. */
  refundAmount?: MoneyInput | null;
}

export interface RefundOrderInput {
  amount: MoneyInput;
  reason: string;
}

/** Переходы, которые сотрудник делает кнопкой «сменить статус» (domain STAFF_TRANSITION_TARGETS). */
export const STAFF_TRANSITION_TARGETS = ['accepted', 'cooking', 'ready', 'delivering', 'completed'] as const;
export type StaffTransitionTarget = (typeof STAFF_TRANSITION_TARGETS)[number];

// ---------------------------------------------------------------- Расчёт и оформление телефонного заказа

export interface OrderLineInput {
  dishId: string;
  quantity: number;
  modifierOptionIds: string[];
}

export interface QuoteOrderInput {
  branchId: string;
  type: OrderType;
  items: OrderLineInput[];
  point?: GeoPoint | null;
  promoCode?: string | null;
  certificateCode?: string | null;
  phone?: string | null;
}

export interface QuoteModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  name: string;
  price: Money;
}

export interface QuoteLine {
  index: number;
  dishId: string;
  name: string | null;
  photoUrl: string | null;
  quantity: number;
  unitPrice: Money | null;
  lineTotal: Money | null;
  modifiers: QuoteModifier[];
  available: boolean;
  problem: string | null;
}

export interface QuoteDelivery {
  pointProvided: boolean;
  deliverable: boolean;
  zoneId: string | null;
  zoneName: string | null;
  etaMinutes: number | null;
  minOrderAmount: Money | null;
  minOrderReached: boolean;
  minOrderShortfall: Money;
  baseDeliveryFee: Money;
  freeDeliveryFrom: Money | null;
  amountToFreeDelivery: Money | null;
  freeDeliveryReason: 'threshold' | 'promo' | null;
}

export interface QuotePromo {
  code: string;
  applied: boolean;
  reason: string | null;
  details: Record<string, unknown> | null;
  discount: Money;
  freeDelivery: boolean;
}

export interface QuoteCertificate {
  applied: boolean;
  reason: string | null;
  maskedCode: string | null;
  balance: Money | null;
  expiresAt: string | null;
  amount: Money;
}

export interface OrderQuote {
  branchId: string;
  type: OrderType;
  lines: QuoteLine[];
  subtotal: Money;
  discount: Money;
  deliveryFee: Money;
  total: Money;
  amountDue: Money;
  delivery: QuoteDelivery | null;
  promo: QuotePromo | null;
  certificate: QuoteCertificate | null;
  /** Что мешает оформить (машинные коды). */
  problems: string[];
  canCheckout: boolean;
}

export interface CheckoutDeliveryInput {
  point: GeoPoint;
  addressText: string;
  apartment?: string | null;
  entrance?: string | null;
  floor?: string | null;
  intercom?: string | null;
  courierComment?: string | null;
}

export interface AdminCreateOrderInput {
  branchId: string;
  type: OrderType;
  items: OrderLineInput[];
  delivery?: CheckoutDeliveryInput | null;
  contactless: boolean;
  scheduledFor?: string | null;
  customer: { name: string; phone: string; email?: string | null };
  comment?: string | null;
  promoCode?: string | null;
  certificateCode?: string | null;
  paymentMethod: CheckoutPaymentMethod;
  consent: { personalData: boolean; marketing?: boolean | null };
  locale: 'kk' | 'ru' | 'en';
  idempotencyKey: string;
}

// ---------------------------------------------------------------- Витрина: меню филиала и время

export interface PublicDishCard {
  id: string;
  slug: string;
  categoryId: string;
  name: string;
  description: string;
  price: Money;
  available: boolean;
  availability: 'available' | 'stopped_shown' | 'stopped_hidden';
  weightGrams: number | null;
  hasModifiers: boolean;
  hasRequiredModifiers: boolean;
  photo: { url: string } | null;
}

export interface PublicMenuCategory {
  id: string;
  slug: string;
  name: string;
  dishes: PublicDishCard[];
}

export interface PublicMenu {
  branch: { id: string; slug: string; name: string };
  categories: PublicMenuCategory[];
}

export interface PublicModifierOption {
  id: string;
  name: string;
  price: Money;
  isDefault: boolean;
}

export interface PublicModifierGroup {
  id: string;
  name: string;
  description: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  options: PublicModifierOption[];
}

export interface PublicDishDetail extends PublicDishCard {
  modifierGroups: PublicModifierGroup[];
}

export interface OrderSlots {
  branchId: string;
  type: OrderType;
  date: string;
  timezone: string;
  leadMinutes: number;
  asap: { available: boolean; reason: 'closed' | 'closing_soon' | null; readyAt: string | null };
  slots: Array<{ at: string; time: string }>;
  dates: string[];
}

export interface PublicDeliveryZone {
  id: string;
  branchId: string;
  name: string;
  polygon: GeoPoint[];
  minOrderAmount: Money;
  deliveryFee: Money;
  freeDeliveryFrom: Money | null;
  etaMinutes: number;
}
