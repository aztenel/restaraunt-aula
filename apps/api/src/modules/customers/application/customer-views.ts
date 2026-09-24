import { MoneyJson } from '../../../shared/kernel/money';
import { Locale } from '../../../shared/kernel/translatable';
import { isAnonymizedPhone } from '../domain/customer';
import { CustomerRecord } from '../infrastructure/customer.repository';
import { CustomerProfile } from '../public';

/** Карточка гостя для админки. У обезличенного гостя телефона нет (маркер наружу не отдаётся). */
export interface CustomerAdminView {
  id: string;
  phone: string | null;
  name: string | null;
  email: string | null;
  locale: Locale;
  birthday: string | null;
  tags: string[];
  allergies: string | null;
  preferences: string | null;
  notes: string | null;
  personalDataConsent: boolean;
  personalDataConsentVersion: string | null;
  personalDataConsentAt: Date | null;
  marketingConsent: boolean;
  marketingConsentVersion: string | null;
  marketingConsentAt: Date | null;
  ordersCount: number;
  completedOrdersCount: number;
  totalSpent: MoneyJson;
  reservationsCount: number;
  noShowCount: number;
  banquetsCount: number;
  firstSeenAt: Date;
  lastActivityAt: Date | null;
  anonymizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toAdminView(c: CustomerRecord): CustomerAdminView {
  return {
    id: c.id,
    phone: isAnonymizedPhone(c.phone) ? null : c.phone,
    name: c.name,
    email: c.email,
    locale: c.locale,
    birthday: c.birthday,
    tags: c.tags,
    allergies: c.allergies,
    preferences: c.preferences,
    notes: c.notes,
    personalDataConsent: c.personalDataConsent,
    personalDataConsentVersion: c.personalDataConsentVersion,
    personalDataConsentAt: c.personalDataConsentAt,
    marketingConsent: c.marketingConsent,
    marketingConsentVersion: c.marketingConsentVersion,
    marketingConsentAt: c.marketingConsentAt,
    ordersCount: c.ordersCount,
    completedOrdersCount: c.completedOrdersCount,
    totalSpent: c.totalSpent.toJSON(),
    reservationsCount: c.reservationsCount,
    noShowCount: c.noShowCount,
    banquetsCount: c.banquetsCount,
    firstSeenAt: c.firstSeenAt,
    lastActivityAt: c.lastActivityAt,
    anonymizedAt: c.anonymizedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Профиль гостя для других модулей (публичный контракт). */
export function toProfile(c: CustomerRecord): CustomerProfile {
  return {
    id: c.id,
    phone: c.phone,
    name: c.name,
    email: c.email,
    locale: c.locale,
    tags: c.tags,
    allergies: c.allergies,
    preferences: c.preferences,
    personalDataConsent: c.personalDataConsent,
    marketingConsent: c.marketingConsent,
  };
}
