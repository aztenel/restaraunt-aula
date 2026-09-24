import { GeoPoint } from '../../../shared/kernel/geo';
import { OpeningHours } from '../../../shared/kernel/time';
import { Translatable } from '../../../shared/kernel/translatable';

/** Способы оплаты, которые филиал принимает на витрине. */
export type BranchPaymentMethod = 'online' | 'on_receipt';

/** Настройки филиала, влияющие на бизнес-правила других модулей. */
export interface BranchSettings {
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  acceptsReservations: boolean;
  /** Минимальное время приготовления до доставки / самовывоза, минут. */
  deliveryLeadMinutes: number;
  pickupLeadMinutes: number;
  /** На сколько дней вперёд можно оформить заказ ко времени. */
  maxScheduleDaysAhead: number;
  /** Стоп-лист: блюдо скрывается или показывается как недоступное. */
  stopListMode: 'hide' | 'mark_unavailable';
  paymentMethods: BranchPaymentMethod[];
  /** Через сколько минут неоплаченный онлайн-заказ отменяется автоматически. */
  awaitingPaymentTimeoutMinutes: number;
  /** Подтверждение телефона SMS-кодом: для заказов с оплатой при получении и для броней без депозита. */
  requirePhoneVerificationForOnReceipt: boolean;
  requirePhoneVerificationForReservations: boolean;
  /** Номер WhatsApp точки для уведомлений персонала. */
  staffNotifyPhone: string | null;
  /** Чат Telegram персонала точки (этап 2). */
  staffTelegramChatId: string | null;
}

export const DEFAULT_BRANCH_SETTINGS: BranchSettings = {
  acceptsDelivery: true,
  acceptsPickup: true,
  acceptsReservations: true,
  deliveryLeadMinutes: 60,
  pickupLeadMinutes: 30,
  maxScheduleDaysAhead: 7,
  stopListMode: 'mark_unavailable',
  paymentMethods: ['online', 'on_receipt'],
  awaitingPaymentTimeoutMinutes: 20,
  requirePhoneVerificationForOnReceipt: true,
  requirePhoneVerificationForReservations: false,
  staffNotifyPhone: null,
  staffTelegramChatId: null,
};

export interface BranchInfo {
  id: string;
  /** Короткий код для номеров документов: 'GL' -> GL-2026-000123. */
  code: string;
  slug: string;
  name: Translatable;
  address: Translatable;
  location: GeoPoint;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  timezone: string;
  openingHours: OpeningHours;
  settings: BranchSettings;
  legalEntityId: string | null;
  isActive: boolean;
  sortOrder: number;
}

/** Справочник филиалов. Всё, что принадлежит точке, ссылается на branch_id. */
export abstract class BranchDirectory {
  /** NotFoundError, если филиала нет. */
  abstract get(branchId: string): Promise<BranchInfo>;
  abstract find(branchId: string): Promise<BranchInfo | null>;
  abstract findBySlug(slug: string): Promise<BranchInfo | null>;
  abstract list(options?: { activeOnly?: boolean }): Promise<BranchInfo[]>;
  /** Открыт ли филиал в указанный момент (по часам работы в его часовом поясе). */
  abstract isOpenAt(branchId: string, at: Date): Promise<boolean>;
}
