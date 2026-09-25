/**
 * Реквизиты компании-заказчика: форма ⇄ API и подсказки валидации (сервер проверяет то же самое:
 * modules/banquet/domain/company.ts). БИН — 12 цифр; ИИК (IBAN) — KZ + 2 цифры + 16 символов;
 * БИК — 8 или 11 символов; КБе — 2 цифры. Пустые необязательные поля не отправляются (станут null).
 */
import { BIK_PATTERN, BIN_PATTERN, IBAN_PATTERN, KBE_PATTERN, normalizeCode } from '@/features/legal-entities/validation';
import type { ClientCompany, CompanyInput } from '../types';

export { BIK_PATTERN, BIN_PATTERN, IBAN_PATTERN, KBE_PATTERN, normalizeCode };

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CompanyFormValues {
  name: string;
  bin: string;
  legalAddress: string;
  bankName?: string;
  iban?: string;
  bik?: string;
  kbe?: string;
  directorName?: string;
  directorPosition?: string;
  actingBasis?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
}

export type CompanyField = keyof CompanyFormValues;
export type CompanyIssue = 'nameRequired' | 'binInvalid' | 'legalAddressRequired' | 'ibanInvalid' | 'bikInvalid' | 'kbeInvalid' | 'emailInvalid';

function opt(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export function companyToForm(company: ClientCompany): CompanyFormValues {
  return {
    name: company.name,
    bin: company.bin,
    legalAddress: company.legalAddress,
    bankName: company.bankName ?? undefined,
    iban: company.iban ?? undefined,
    bik: company.bik ?? undefined,
    kbe: company.kbe ?? undefined,
    directorName: company.directorName ?? undefined,
    directorPosition: company.directorPosition ?? undefined,
    actingBasis: company.actingBasis ?? undefined,
    contactName: company.contactName ?? undefined,
    contactPhone: company.contactPhone ?? undefined,
    contactEmail: company.contactEmail ?? undefined,
  };
}

export function validateCompany(values: CompanyFormValues): Array<{ field: CompanyField; issue: CompanyIssue }> {
  const issues: Array<{ field: CompanyField; issue: CompanyIssue }> = [];
  if (!values.name?.trim()) issues.push({ field: 'name', issue: 'nameRequired' });
  if (!BIN_PATTERN.test(normalizeCode(values.bin))) issues.push({ field: 'bin', issue: 'binInvalid' });
  if (!values.legalAddress?.trim()) issues.push({ field: 'legalAddress', issue: 'legalAddressRequired' });
  const iban = normalizeCode(values.iban);
  if (iban && !IBAN_PATTERN.test(iban)) issues.push({ field: 'iban', issue: 'ibanInvalid' });
  const bik = normalizeCode(values.bik);
  if (bik && !BIK_PATTERN.test(bik)) issues.push({ field: 'bik', issue: 'bikInvalid' });
  const kbe = values.kbe?.trim() ?? '';
  if (kbe && !KBE_PATTERN.test(kbe)) issues.push({ field: 'kbe', issue: 'kbeInvalid' });
  const email = values.contactEmail?.trim() ?? '';
  if (email && !EMAIL_PATTERN.test(email)) issues.push({ field: 'contactEmail', issue: 'emailInvalid' });
  return issues;
}

export function toCompanyInput(values: CompanyFormValues): CompanyInput {
  const iban = normalizeCode(values.iban);
  const bik = normalizeCode(values.bik);
  return {
    name: values.name.trim(),
    bin: normalizeCode(values.bin),
    legalAddress: values.legalAddress.trim(),
    bankName: opt(values.bankName),
    iban: iban || undefined,
    bik: bik || undefined,
    kbe: opt(values.kbe),
    directorName: opt(values.directorName),
    directorPosition: opt(values.directorPosition),
    actingBasis: opt(values.actingBasis),
    contactName: opt(values.contactName),
    contactPhone: opt(values.contactPhone),
    contactEmail: opt(values.contactEmail)?.toLowerCase(),
  };
}
