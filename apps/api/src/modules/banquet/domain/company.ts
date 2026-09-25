import { ValidationError } from '../../../shared/kernel/errors';
import { normalizePhone } from '../../../shared/kernel/phone';

/**
 * Реквизиты компании-заказчика (юрлица): для договора, счёта на оплату, акта и ЭСФ.
 * Хранятся и переиспользуются между заявками.
 */
export interface ClientCompanyInput {
  name: string;
  bin: string;
  legalAddress: string;
  bankName?: string | null;
  iban?: string | null;
  bik?: string | null;
  kbe?: string | null;
  directorName?: string | null;
  directorPosition?: string | null;
  actingBasis?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export interface ClientCompanyData {
  name: string;
  bin: string;
  legalAddress: string;
  bankName: string | null;
  iban: string | null;
  bik: string | null;
  kbe: string | null;
  directorName: string | null;
  directorPosition: string | null;
  actingBasis: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

const BIN_RE = /^\d{12}$/;
/** ИИК в формате IBAN Казахстана: KZ + 2 контрольные цифры + 16 символов. */
const IBAN_RE = /^KZ\d{2}[A-Z0-9]{16}$/;
const BIK_RE = /^[A-Z0-9]{8}([A-Z0-9]{3})?$/;
const KBE_RE = /^\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: string | null | undefined, max: number, field: string, required = false): string | null {
  const v = value?.trim() ?? '';
  if (!v) {
    if (required) throw new ValidationError('banquet_company.field_required', `${field} is required`, { field });
    return null;
  }
  if (v.length > max) throw new ValidationError('banquet_company.field_too_long', `${field} is too long`, { field, max });
  return v;
}

/** БИН — 12 цифр (пробелы допускаются при вводе). */
export function normalizeBin(raw: string): string {
  const bin = (raw ?? '').replace(/\s/g, '');
  if (!BIN_RE.test(bin)) throw new ValidationError('banquet_company.invalid_bin', 'BIN must be 12 digits', { bin: raw });
  return bin;
}

export function normalizeCompany(input: ClientCompanyInput): ClientCompanyData {
  const iban = input.iban ? input.iban.replace(/\s/g, '').toUpperCase() : null;
  if (iban && !IBAN_RE.test(iban)) throw new ValidationError('banquet_company.invalid_iban', 'IBAN must look like KZ + 18 characters');
  const bik = input.bik ? input.bik.replace(/\s/g, '').toUpperCase() : null;
  if (bik && !BIK_RE.test(bik)) throw new ValidationError('banquet_company.invalid_bik', 'BIK must be 8 or 11 latin letters/digits');
  const kbe = input.kbe?.trim() || null;
  if (kbe && !KBE_RE.test(kbe)) throw new ValidationError('banquet_company.invalid_kbe', 'KBE must be 2 digits');
  const email = input.contactEmail?.trim().toLowerCase() || null;
  if (email && !EMAIL_RE.test(email)) throw new ValidationError('banquet_company.invalid_email', 'Invalid email');
  const phone = input.contactPhone?.trim() ? normalizePhone(input.contactPhone) : null;
  return {
    name: text(input.name, 300, 'name', true)!,
    bin: normalizeBin(input.bin),
    legalAddress: text(input.legalAddress, 500, 'legalAddress', true)!,
    bankName: text(input.bankName, 200, 'bankName'),
    iban,
    bik,
    kbe,
    directorName: text(input.directorName, 200, 'directorName'),
    directorPosition: text(input.directorPosition, 200, 'directorPosition'),
    actingBasis: text(input.actingBasis, 200, 'actingBasis'),
    contactName: text(input.contactName, 200, 'contactName'),
    contactPhone: phone,
    contactEmail: email,
  };
}

/** Для счёта юрлицу нужны банковские реквизиты заказчика не обязательно, но БИН и адрес — всегда. */
export function companyShort(c: Pick<ClientCompanyData, 'name' | 'bin'>): { name: string; bin: string } {
  return { name: c.name, bin: c.bin };
}
