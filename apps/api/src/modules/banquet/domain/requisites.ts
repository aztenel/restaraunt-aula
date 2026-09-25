import { BanquetContact } from '../public';
import { ClientCompanyData } from './company';
import { PayerType } from './invoice';

/**
 * Снимки реквизитов сторон в документах (смета, счёт, акт): документ не меняется,
 * если потом поменялись реквизиты юрлица-продавца или компании-заказчика.
 */
export interface SellerSnapshot {
  name: string;
  shortName: string;
  bin: string;
  legalAddress: string;
  actualAddress: string | null;
  directorName: string;
  directorPosition: string;
  actingBasis: string;
  bankName: string;
  iban: string;
  bik: string;
  kbe: string;
  vatPayer: boolean;
  /** Ставка НДС в базисных пунктах (1600 = 16%). */
  vatRateBp: number;
  vatCertificate: string | null;
  phone: string | null;
  email: string | null;
}

export interface BuyerSnapshot {
  type: PayerType;
  companyId: string | null;
  name: string;
  bin: string | null;
  legalAddress: string | null;
  bankName: string | null;
  iban: string | null;
  bik: string | null;
  kbe: string | null;
  directorName: string | null;
  directorPosition: string | null;
  actingBasis: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
}

export function buyerFromCompany(companyId: string, c: ClientCompanyData, contact: BanquetContact): BuyerSnapshot {
  return {
    type: 'company',
    companyId,
    name: c.name,
    bin: c.bin,
    legalAddress: c.legalAddress,
    bankName: c.bankName,
    iban: c.iban,
    bik: c.bik,
    kbe: c.kbe,
    directorName: c.directorName,
    directorPosition: c.directorPosition,
    actingBasis: c.actingBasis,
    contactName: c.contactName ?? contact.name,
    phone: c.contactPhone ?? contact.phone,
    email: c.contactEmail ?? contact.email,
  };
}

export function buyerFromContact(contact: BanquetContact): BuyerSnapshot {
  return {
    type: 'individual',
    companyId: null,
    name: contact.name,
    bin: null,
    legalAddress: null,
    bankName: null,
    iban: null,
    bik: null,
    kbe: null,
    directorName: null,
    directorPosition: null,
    actingBasis: null,
    contactName: contact.name,
    phone: contact.phone,
    email: contact.email,
  };
}
