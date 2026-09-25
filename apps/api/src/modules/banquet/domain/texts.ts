import { Locale, Translatable, translate } from '../../../shared/kernel/translatable';
import { BanquetStatus } from '../public';

/** Типы мероприятий (коды — латиницей, подписи — на языках витрины). */
export const BANQUET_EVENT_TYPES = ['wedding', 'birthday', 'corporate', 'anniversary', 'kudalyk', 'memorial', 'graduation', 'other'] as const;
export type BanquetEventType = (typeof BANQUET_EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<BanquetEventType, Translatable> = {
  wedding: { ru: 'Свадьба', kk: 'Үйлену тойы', en: 'Wedding' },
  birthday: { ru: 'День рождения', kk: 'Туған күн', en: 'Birthday' },
  corporate: { ru: 'Корпоратив', kk: 'Корпоративтік кеш', en: 'Corporate event' },
  anniversary: { ru: 'Юбилей', kk: 'Мерейтой', en: 'Anniversary' },
  kudalyk: { ru: 'Құдалық (сватовство)', kk: 'Құдалық', en: 'Kudalyk (matchmaking)' },
  memorial: { ru: 'Еске алу (поминки)', kk: 'Еске алу', en: 'Memorial' },
  graduation: { ru: 'Выпускной', kk: 'Бітіру кеші', en: 'Graduation' },
  other: { ru: 'Другое мероприятие', kk: 'Басқа іс-шара', en: 'Other event' },
};

export const STATUS_LABELS: Record<BanquetStatus, Translatable> = {
  new: { ru: 'Новая', kk: 'Жаңа', en: 'New' },
  in_progress: { ru: 'В работе', kk: 'Жұмыста', en: 'In progress' },
  quote_sent: { ru: 'Смета отправлена', kk: 'Смета жіберілді', en: 'Quote sent' },
  agreed: { ru: 'Согласована', kk: 'Келісілді', en: 'Agreed' },
  prepaid: { ru: 'Предоплата получена', kk: 'Алдын ала төлем алынды', en: 'Prepaid' },
  held: { ru: 'Проведено', kk: 'Өтті', en: 'Held' },
  cancelled: { ru: 'Отменена', kk: 'Бас тартылды', en: 'Cancelled' },
};

/** Виды позиций сметы: из меню и произвольные (аренда зала, музыканты, оформление, обслуживание). */
export const QUOTE_LINE_KINDS = ['menu', 'hall_rent', 'musicians', 'decoration', 'service', 'other'] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

export const LINE_KIND_LABELS: Record<QuoteLineKind, Translatable> = {
  menu: { ru: 'Меню', kk: 'Мәзір', en: 'Menu' },
  hall_rent: { ru: 'Аренда зала', kk: 'Зал жалға алу', en: 'Hall rent' },
  musicians: { ru: 'Музыканты', kk: 'Музыканттар', en: 'Musicians' },
  decoration: { ru: 'Оформление', kk: 'Безендіру', en: 'Decoration' },
  service: { ru: 'Обслуживание', kk: 'Қызмет көрсету', en: 'Service' },
  other: { ru: 'Прочее', kk: 'Басқа', en: 'Other' },
};

export function eventTypeLabel(type: string, locale: Locale): string {
  return translate(EVENT_TYPE_LABELS[type as BanquetEventType] ?? { ru: type }, locale);
}

export function statusLabel(status: BanquetStatus, locale: Locale): string {
  return translate(STATUS_LABELS[status], locale);
}
