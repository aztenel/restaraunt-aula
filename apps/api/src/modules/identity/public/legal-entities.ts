/**
 * Юрлицо-продавец (реквизиты для счетов, договоров, актов, ЭСФ).
 * Сеть может расти за счёт франчайзи — у каждой точки может быть своё юрлицо.
 */
export interface LegalEntityInfo {
  id: string;
  /** Полное наименование: ТОО «Express kitchen». */
  name: string;
  shortName: string;
  /** БИН, 12 цифр. */
  bin: string;
  legalAddress: string;
  actualAddress: string | null;
  directorName: string;
  directorPosition: string;
  /** «действующего на основании Устава». */
  actingBasis: string;
  bankName: string;
  /** ИИК (IBAN KZ...). */
  iban: string;
  bik: string;
  kbe: string;
  vatPayer: boolean;
  /** Ставка НДС в базисных пунктах (1600 = 16%). 0 — не плательщик НДС. */
  vatRateBp: number;
  vatCertificate: string | null;
  phone: string | null;
  email: string | null;
}

export abstract class LegalEntityDirectory {
  abstract get(id: string): Promise<LegalEntityInfo>;
  /** Юрлицо филиала; если у филиала не задано — юрлицо по умолчанию. */
  abstract forBranch(branchId: string | null): Promise<LegalEntityInfo>;
}
