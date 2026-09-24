/**
 * Публичный контракт модуля Notifications: уведомления гостю (WhatsApp, SMS, email)
 * и персоналу (WhatsApp точки, Telegram), лента событий админки (очереди со звуком).
 *
 * Отправка всегда асинхронна: запись создаётся в транзакции вызывающего кода, доставка — задачей
 * с повторами. Недоступность мессенджера не блокирует приём заказа: уведомление откладывается.
 */
import { Permission } from '../../../shared/kernel/permissions';
import { Locale } from '../../../shared/kernel/translatable';

export const NotificationChannel = {
  WhatsApp: 'whatsapp',
  Sms: 'sms',
  Email: 'email',
  Telegram: 'telegram',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

/**
 * Шаблоны гостевых уведомлений и их параметры (все значения — строки, уже отформатированные).
 * Тексты kk/ru хранятся в модуле Notifications и редактируются в админке.
 */
export interface GuestTemplateParams {
  'otp.code': { code: string };
  'order.created': { number: string; total: string; trackingUrl: string; branchName: string };
  'order.paid': { number: string; total: string; trackingUrl: string };
  'order.accepted': { number: string; trackingUrl: string; eta: string };
  'order.ready': { number: string; trackingUrl: string; branchName: string; branchAddress: string };
  'order.delivering': { number: string; trackingUrl: string };
  'order.completed': { number: string };
  'order.cancelled': { number: string; reason: string };
  'order.refunded': { number: string; amount: string };
  'reservation.pending': { number: string; branchName: string; date: string; time: string; guests: string; manageUrl: string };
  'reservation.awaiting_deposit': {
    number: string;
    branchName: string;
    date: string;
    time: string;
    deposit: string;
    paymentUrl: string;
    holdUntil: string;
  };
  'reservation.confirmed': {
    number: string;
    branchName: string;
    branchAddress: string;
    venueName: string;
    date: string;
    time: string;
    guests: string;
    manageUrl: string;
  };
  'reservation.reminder': { number: string; branchName: string; branchAddress: string; date: string; time: string; manageUrl: string };
  'reservation.cancelled': { number: string; date: string; time: string; depositNote: string };
  'reservation.expired': { number: string; date: string; time: string };
  'banquet.request_received': { number: string; managerName: string; managerPhone: string };
  'banquet.quote_sent': { number: string; quoteUrl: string; total: string; managerName: string };
  'banquet.invoice_issued': { number: string; invoiceNumber: string; amount: string; dueDate: string; paymentUrl: string };
  'banquet.payment_received': { number: string; amount: string; remaining: string };
  'certificate.issued': { code: string; nominal: string; expiresAt: string; recipientName: string; message: string };
  'certificate.redeemed': { amount: string; balance: string };
}
export type GuestTemplate = keyof GuestTemplateParams;

export interface StaffTemplateParams {
  'staff.order_new': { number: string; type: string; total: string; branchName: string; adminUrl: string };
  'staff.order_paid': { number: string; total: string; adminUrl: string };
  'staff.reservation_new': { number: string; date: string; time: string; guests: string; venueName: string; adminUrl: string };
  'staff.reservation_cancelled': { number: string; date: string; time: string };
  'staff.banquet_new': { number: string; eventDate: string; guests: string; budget: string; managerName: string; adminUrl: string };
  'staff.banquet_assigned': { number: string; eventDate: string; adminUrl: string };
  'staff.banquet_sla_breach': { number: string; minutes: string; managerName: string; adminUrl: string };
  'staff.daily_report': { date: string; summary: string; adminUrl: string };
  'staff.system_alert': { title: string; details: string };
  'staff.refund_failed': { reference: string; amount: string; error: string };
}
export type StaffTemplate = keyof StaffTemplateParams;

export interface GuestRecipient {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
}

export interface NotificationAttachment {
  /** Ключ файла в приватном хранилище (FileStorage). */
  fileKey: string;
  filename: string;
  contentType: string;
}

export abstract class Notifier {
  /**
   * Уведомление гостю. channels — порядок предпочтения (по умолчанию WhatsApp, затем SMS как резерв).
   * dedupeKey защищает от повторной отправки одного и того же (например, 'order:<id>:accepted').
   */
  abstract notifyGuest<T extends GuestTemplate>(input: {
    recipient: GuestRecipient;
    template: T;
    params: GuestTemplateParams[T];
    locale: Locale;
    channels?: NotificationChannel[];
    attachments?: NotificationAttachment[];
    dedupeKey?: string;
    related?: { type: string; id: string };
  }): Promise<void>;

  /**
   * Уведомление персоналу. Адресаты: сотрудники с правом в филиале (WhatsApp/Telegram из профиля)
   * + каналы точки (WhatsApp точки, Telegram-чат филиала) при includeBranchChannels.
   */
  abstract notifyStaff<T extends StaffTemplate>(input: {
    audience: { branchId: string | null; permission?: Permission; userIds?: string[]; includeBranchChannels?: boolean };
    template: T;
    params: StaffTemplateParams[T];
    dedupeKey?: string;
    related?: { type: string; id: string };
  }): Promise<void>;
}

export type AdminFeedStream = 'orders' | 'reservations' | 'banquets' | 'system';

export interface AdminFeedEvent {
  branchId: string | null;
  stream: AdminFeedStream;
  /** 'created' — новый элемент очереди (со звуком), 'updated' — изменение. */
  kind: 'created' | 'updated';
  entityId: string;
  title: string;
  sound?: boolean;
}

/** Лента событий админки: SSE, очереди новых заказов, броней и заявок со звуковым уведомлением. */
export abstract class AdminFeed {
  /** Публикуется после коммита текущей транзакции. */
  abstract push(event: AdminFeedEvent): Promise<void>;
}
