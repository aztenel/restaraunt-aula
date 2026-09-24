import {
  GuestTemplate,
  GuestTemplateParams,
  NotificationChannel,
  StaffTemplate,
  StaffTemplateParams,
} from '../public';

/**
 * Реестр шаблонов уведомлений. Ключи и параметры — из публичного контракта модуля
 * (GuestTemplateParams / StaffTemplateParams); здесь — описание для админки, пример параметров
 * (предпросмотр, тестовая отправка), чувствительные параметры и срок актуальности сообщения.
 *
 * Пример параметров типизирован контрактом: лишний или пропущенный параметр — ошибка компиляции,
 * поэтому список параметров шаблона всегда совпадает с контрактом.
 */
export type TemplateKey = GuestTemplate | StaffTemplate;
export type TemplateAudience = 'guest' | 'staff';

/** Каналы, для которых у шаблонов есть тексты. Гостю — WhatsApp, SMS, email; персоналу — WhatsApp и Telegram. */
export const AUDIENCE_CHANNELS: Record<TemplateAudience, readonly NotificationChannel[]> = {
  guest: ['whatsapp', 'sms', 'email'],
  staff: ['whatsapp', 'telegram'],
};

/** Языки, для которых обязательны стартовые тексты. en — опционально (при отсутствии — русский текст). */
export const REQUIRED_TEMPLATE_LOCALES = ['ru', 'kk'] as const;

/** Персоналу пишем по-русски (язык админки); тексты на казахском есть и редактируются в админке. */
export const STAFF_LOCALE = 'ru' as const;

const DEFAULT_TTL_MINUTES = 24 * 60;

interface TemplateDefinition<P> {
  title: { ru: string; kk: string };
  sample: P;
  /** Параметры, которые не показываются в журнале и хранятся зашифрованными (коды). */
  sensitive?: ReadonlyArray<Extract<keyof P, string>>;
  /** Через сколько минут неотправленное сообщение теряет смысл (например, код подтверждения). */
  ttlMinutes?: number;
}

const GUEST_TEMPLATES: { [K in GuestTemplate]: TemplateDefinition<GuestTemplateParams[K]> } = {
  'otp.code': {
    title: { ru: 'Код подтверждения телефона', kk: 'Телефонды растау коды' },
    sample: { code: '4821' },
    sensitive: ['code'],
    ttlMinutes: 10,
  },
  'order.created': {
    title: { ru: 'Заказ оформлен', kk: 'Тапсырыс рәсімделді' },
    sample: { number: 'GL-2026-000123', total: '12 500 ₸', trackingUrl: 'https://aula.kz/t/7KQ2MX', branchName: 'AULA GreenLine Aqua' },
  },
  'order.paid': {
    title: { ru: 'Заказ оплачен', kk: 'Тапсырыс төленді' },
    sample: { number: 'GL-2026-000123', total: '12 500 ₸', trackingUrl: 'https://aula.kz/t/7KQ2MX' },
  },
  'order.accepted': {
    title: { ru: 'Заказ принят рестораном', kk: 'Тапсырысты мейрамхана қабылдады' },
    sample: { number: 'GL-2026-000123', trackingUrl: 'https://aula.kz/t/7KQ2MX', eta: '19:40' },
  },
  'order.ready': {
    title: { ru: 'Заказ готов к выдаче', kk: 'Тапсырыс беруге дайын' },
    sample: {
      number: 'GL-2026-000123',
      trackingUrl: 'https://aula.kz/t/7KQ2MX',
      branchName: 'AULA GreenLine Aqua',
      branchAddress: 'Астана, ул. Е-899, 1/1',
    },
  },
  'order.delivering': {
    title: { ru: 'Заказ передан курьеру', kk: 'Тапсырыс курьерге берілді' },
    sample: { number: 'GL-2026-000123', trackingUrl: 'https://aula.kz/t/7KQ2MX' },
  },
  'order.completed': {
    title: { ru: 'Заказ выполнен', kk: 'Тапсырыс орындалды' },
    sample: { number: 'GL-2026-000123' },
  },
  'order.cancelled': {
    title: { ru: 'Заказ отменён', kk: 'Тапсырыс жойылды' },
    sample: { number: 'GL-2026-000123', reason: 'нет курьеров в вашем районе' },
  },
  'order.refunded': {
    title: { ru: 'Возврат по заказу', kk: 'Тапсырыс бойынша қайтарым' },
    sample: { number: 'GL-2026-000123', amount: '12 500 ₸' },
  },
  'reservation.pending': {
    title: { ru: 'Бронь ждёт подтверждения', kk: 'Брондау расталуды күтуде' },
    sample: {
      number: 'GV-2026-000045',
      branchName: 'AULA Garden View',
      date: '25.10.2026',
      time: '19:30',
      guests: '6',
      manageUrl: 'https://aula.kz/r/X7K2P9',
    },
  },
  'reservation.awaiting_deposit': {
    title: { ru: 'Бронь ждёт оплаты депозита', kk: 'Брондау депозит төлемін күтуде' },
    sample: {
      number: 'GV-2026-000045',
      branchName: 'AULA Garden View',
      date: '25.10.2026',
      time: '19:30',
      deposit: '50 000 ₸',
      paymentUrl: 'https://aula.kz/p/Q4W8E2',
      holdUntil: '12:30',
    },
  },
  'reservation.confirmed': {
    title: { ru: 'Бронь подтверждена', kk: 'Брондау расталды' },
    sample: {
      number: 'GV-2026-000045',
      branchName: 'AULA Garden View',
      branchAddress: 'Астана, пр. Кабанбай батыра, 56',
      venueName: 'VIP-зал «Жібек»',
      date: '25.10.2026',
      time: '19:30',
      guests: '6',
      manageUrl: 'https://aula.kz/r/X7K2P9',
    },
  },
  'reservation.reminder': {
    title: { ru: 'Напоминание о брони', kk: 'Брондау туралы еске салу' },
    sample: {
      number: 'GV-2026-000045',
      branchName: 'AULA Garden View',
      branchAddress: 'Астана, пр. Кабанбай батыра, 56',
      date: '25.10.2026',
      time: '19:30',
      manageUrl: 'https://aula.kz/r/X7K2P9',
    },
  },
  'reservation.cancelled': {
    title: { ru: 'Бронь отменена', kk: 'Брондау жойылды' },
    sample: { number: 'GV-2026-000045', date: '25.10.2026', time: '19:30', depositNote: 'Депозит 50 000 ₸ будет возвращён.' },
  },
  'reservation.expired': {
    title: { ru: 'Бронь снята (не подтверждена вовремя)', kk: 'Брондау жойылды (уақытында расталмады)' },
    sample: { number: 'GV-2026-000045', date: '25.10.2026', time: '19:30' },
  },
  'banquet.request_received': {
    title: { ru: 'Банкетная заявка принята', kk: 'Банкет өтінімі қабылданды' },
    sample: { number: 'BQ-2026-000012', managerName: 'Айгерим', managerPhone: '+7 701 234 56 78' },
  },
  'banquet.quote_sent': {
    title: { ru: 'Смета по банкету', kk: 'Банкет сметасы' },
    sample: { number: 'BQ-2026-000012', quoteUrl: 'https://aula.kz/q/M3N8B1', total: '850 000 ₸', managerName: 'Айгерим' },
  },
  'banquet.invoice_issued': {
    title: { ru: 'Счёт на оплату банкета', kk: 'Банкетті төлеуге шот' },
    sample: {
      number: 'BQ-2026-000012',
      invoiceNumber: 'GV-2026-000031',
      amount: '425 000 ₸',
      dueDate: '30.10.2026',
      paymentUrl: 'https://aula.kz/p/Z5C1V7',
    },
  },
  'banquet.payment_received': {
    title: { ru: 'Оплата по банкету получена', kk: 'Банкет бойынша төлем алынды' },
    sample: { number: 'BQ-2026-000012', amount: '425 000 ₸', remaining: '425 000 ₸' },
  },
  'certificate.issued': {
    title: { ru: 'Подарочный сертификат', kk: 'Сыйлық сертификаты' },
    sample: {
      code: 'K7PQ-4MXZ-9TWA',
      nominal: '30 000 ₸',
      expiresAt: '25.10.2027',
      recipientName: 'Айгерим',
      message: 'С днём рождения!',
    },
    sensitive: ['code'],
  },
  'certificate.redeemed': {
    title: { ru: 'Списание с сертификата', kk: 'Сертификаттан есептен шығару' },
    sample: { amount: '12 500 ₸', balance: '17 500 ₸' },
  },
};

const STAFF_TEMPLATES: { [K in StaffTemplate]: TemplateDefinition<StaffTemplateParams[K]> } = {
  'staff.order_new': {
    title: { ru: 'Новый заказ (персоналу)', kk: 'Жаңа тапсырыс (қызметкерлерге)' },
    sample: {
      number: 'GL-2026-000123',
      type: 'доставка',
      total: '12 500 ₸',
      branchName: 'AULA GreenLine Aqua',
      adminUrl: 'https://admin.aula.kz/orders/GL-2026-000123',
    },
  },
  'staff.order_paid': {
    title: { ru: 'Заказ оплачен (персоналу)', kk: 'Тапсырыс төленді (қызметкерлерге)' },
    sample: { number: 'GL-2026-000123', total: '12 500 ₸', adminUrl: 'https://admin.aula.kz/orders/GL-2026-000123' },
  },
  'staff.reservation_new': {
    title: { ru: 'Новая бронь (персоналу)', kk: 'Жаңа брондау (қызметкерлерге)' },
    sample: {
      number: 'GV-2026-000045',
      date: '25.10.2026',
      time: '19:30',
      guests: '6',
      venueName: 'VIP-зал «Жібек»',
      adminUrl: 'https://admin.aula.kz/reservations/GV-2026-000045',
    },
  },
  'staff.reservation_cancelled': {
    title: { ru: 'Бронь отменена (персоналу)', kk: 'Брондау жойылды (қызметкерлерге)' },
    sample: { number: 'GV-2026-000045', date: '25.10.2026', time: '19:30' },
  },
  'staff.banquet_new': {
    title: { ru: 'Новая банкетная заявка', kk: 'Жаңа банкет өтінімі' },
    sample: {
      number: 'BQ-2026-000012',
      eventDate: '14.11.2026',
      guests: '40',
      budget: '600 000 ₸',
      managerName: 'Айгерим',
      adminUrl: 'https://admin.aula.kz/banquets/BQ-2026-000012',
    },
  },
  'staff.banquet_assigned': {
    title: { ru: 'Банкетная заявка назначена менеджеру', kk: 'Банкет өтінімі менеджерге тағайындалды' },
    sample: { number: 'BQ-2026-000012', eventDate: '14.11.2026', adminUrl: 'https://admin.aula.kz/banquets/BQ-2026-000012' },
  },
  'staff.banquet_sla_breach': {
    title: { ru: 'Просрочен ответ по банкетной заявке', kk: 'Банкет өтініміне жауап беру мерзімі өтті' },
    sample: { number: 'BQ-2026-000012', minutes: '45', managerName: 'Айгерим', adminUrl: 'https://admin.aula.kz/banquets/BQ-2026-000012' },
  },
  'staff.daily_report': {
    title: { ru: 'Дневной отчёт', kk: 'Күндізгі есеп' },
    sample: {
      date: '25.10.2026',
      summary: 'выручка 1 250 000 ₸, заказов 84, средний чек 14 880 ₸',
      adminUrl: 'https://admin.aula.kz/reports/daily',
    },
  },
  'staff.system_alert': {
    title: { ru: 'Системное оповещение', kk: 'Жүйелік хабарлама' },
    sample: { title: 'Задача в очереди неудач', details: 'payments.poll_status: timeout, попыток: 8' },
  },
  'staff.refund_failed': {
    title: { ru: 'Возврат не выполнен', kk: 'Қайтару орындалмады' },
    sample: { reference: 'заказ GL-2026-000123', amount: '12 500 ₸', error: 'провайдер отклонил возврат' },
  },
};

/** Описание шаблона для приложения и админки. */
export interface TemplateInfo {
  key: TemplateKey;
  audience: TemplateAudience;
  title: { ru: string; kk: string };
  /** Параметры в порядке объявления (порядок по умолчанию для позиционных параметров WhatsApp). */
  params: string[];
  sample: Record<string, string>;
  sensitive: string[];
  ttlMinutes: number;
  channels: readonly NotificationChannel[];
}

function toInfo(key: TemplateKey, audience: TemplateAudience, def: TemplateDefinition<object>): TemplateInfo {
  const sample = def.sample as Record<string, string>;
  return {
    key,
    audience,
    title: def.title,
    params: Object.keys(sample),
    sample: { ...sample },
    sensitive: [...((def.sensitive as string[] | undefined) ?? [])],
    ttlMinutes: def.ttlMinutes ?? DEFAULT_TTL_MINUTES,
    channels: AUDIENCE_CHANNELS[audience],
  };
}

const REGISTRY = new Map<string, TemplateInfo>([
  ...Object.entries(GUEST_TEMPLATES).map(([k, d]) => [k, toInfo(k as TemplateKey, 'guest', d as TemplateDefinition<object>)] as const),
  ...Object.entries(STAFF_TEMPLATES).map(([k, d]) => [k, toInfo(k as TemplateKey, 'staff', d as TemplateDefinition<object>)] as const),
]);

export const GUEST_TEMPLATE_KEYS = Object.keys(GUEST_TEMPLATES) as GuestTemplate[];
export const STAFF_TEMPLATE_KEYS = Object.keys(STAFF_TEMPLATES) as StaffTemplate[];
export const TEMPLATE_KEYS: TemplateKey[] = [...GUEST_TEMPLATE_KEYS, ...STAFF_TEMPLATE_KEYS];

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === 'string' && REGISTRY.has(value);
}

export function templateInfo(key: string): TemplateInfo | undefined {
  return REGISTRY.get(key);
}

export function allTemplates(): TemplateInfo[] {
  return [...REGISTRY.values()];
}

/**
 * Канал, чей текст используется при отправке в канал без собственного текста
 * (например, тестовая отправка шаблона персонала по SMS): сначала сам канал, затем WhatsApp, Telegram, SMS.
 */
export function textChannelFor(info: TemplateInfo, channel: NotificationChannel): NotificationChannel {
  if (info.channels.includes(channel)) return channel;
  const order: NotificationChannel[] = ['whatsapp', 'telegram', 'sms', 'email'];
  return order.find((c) => info.channels.includes(c)) ?? info.channels[0]!;
}
