import { NotificationChannel } from '../public';
import { DeliveryStep } from './delivery';

/**
 * План доставки: кому и какими каналами отправлять.
 *
 * Гостю (решения «Уведомления»): WhatsApp, при недоступности — SMS; документы — на email
 * и дополнительно ссылкой в WhatsApp (с резервом SMS). Явно переданные каналы — порядок предпочтения
 * одной цепочки (первый доступный, остальные — резерв).
 *
 * Персоналу: WhatsApp и Telegram не резервируют, а дублируют друг друга (Telegram — дублирование
 * уведомлений персоналу, этап 2): каждый адрес — отдельная доставка.
 */
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['whatsapp', 'sms', 'email', 'telegram'];

export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === 'string' && (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

export type ChannelPlan = NotificationChannel[][];

export type DeliveryTargetKind = 'guest' | 'staff_user' | 'branch' | 'direct';

export interface PlannedDelivery {
  targetKind: DeliveryTargetKind;
  staffUserId: string | null;
  recipientName: string | null;
  /** Шаги с адресами. Пустая цепочка — у адресата нет адреса ни для одного канала (доставка сразу неуспешна). */
  chain: DeliveryStep[];
  /** Первый канал запрошенной цепочки — для записи о недоставленном сообщении без адреса. */
  requestedChannel: NotificationChannel;
}

export const DEFAULT_GUEST_CHAIN: readonly NotificationChannel[] = ['whatsapp', 'sms'];

/** План каналов гостю: явный порядок предпочтения или правило по умолчанию. */
export function guestChannelPlan(channels: readonly NotificationChannel[] | undefined | null, hasAttachments: boolean): ChannelPlan {
  if (channels && channels.length > 0) {
    const unique = [...new Set(channels.filter(isNotificationChannel))];
    if (unique.length > 0) return [unique];
  }
  return hasAttachments ? [['email'], [...DEFAULT_GUEST_CHAIN]] : [[...DEFAULT_GUEST_CHAIN]];
}

export interface GuestAddressBook {
  phone: string | null;
  email: string | null;
  name: string | null;
}

function guestAddress(channel: NotificationChannel, recipient: GuestAddressBook): string | null {
  switch (channel) {
    case 'whatsapp':
    case 'sms':
      return recipient.phone;
    case 'email':
      return recipient.email;
    default:
      // У гостя нет чата Telegram: канал для персонала.
      return null;
  }
}

/** Доставки гостю: по одной на цепочку плана; каналы без адреса пропускаются. */
export function planGuestDeliveries(recipient: GuestAddressBook, plan: ChannelPlan): PlannedDelivery[] {
  const result: PlannedDelivery[] = [];
  for (const chain of plan) {
    if (chain.length === 0) continue;
    const steps: DeliveryStep[] = [];
    for (const channel of chain) {
      const address = guestAddress(channel, recipient);
      if (address) steps.push({ channel, address });
    }
    // Документы по email — дополнительный канал: нет почты — просто не отправляем, это не ошибка.
    const optionalEmailChain = plan.length > 1 && chain.length === 1 && chain[0] === 'email';
    if (steps.length === 0 && optionalEmailChain) continue;
    result.push({ targetKind: 'guest', staffUserId: null, recipientName: recipient.name, chain: steps, requestedChannel: chain[0]! });
  }
  return result;
}

export interface StaffContact {
  id: string;
  name: string;
  phone: string | null;
  telegramChatId: string | null;
}

export interface BranchContacts {
  name: string;
  phone: string | null;
  telegramChatId: string | null;
}

/**
 * Доставки персоналу: сотрудникам — WhatsApp на телефон из профиля и Telegram в личный чат;
 * точке — WhatsApp номера точки и Telegram-чат филиала. Один адрес — одна доставка.
 */
export function planStaffDeliveries(input: { members: readonly StaffContact[]; branch: BranchContacts | null }): PlannedDelivery[] {
  const seen = new Set<string>();
  const result: PlannedDelivery[] = [];
  const add = (
    targetKind: DeliveryTargetKind,
    staffUserId: string | null,
    name: string | null,
    channel: NotificationChannel,
    address: string | null,
  ) => {
    const value = address?.trim();
    if (!value) return;
    const key = `${channel}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ targetKind, staffUserId, recipientName: name, chain: [{ channel, address: value }], requestedChannel: channel });
  };
  if (input.branch) {
    add('branch', null, input.branch.name, 'whatsapp', input.branch.phone);
    add('branch', null, input.branch.name, 'telegram', input.branch.telegramChatId);
  }
  for (const m of input.members) {
    add('staff_user', m.id, m.name, 'whatsapp', m.phone);
    add('staff_user', m.id, m.name, 'telegram', m.telegramChatId);
  }
  return result;
}
