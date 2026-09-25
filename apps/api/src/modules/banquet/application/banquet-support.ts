import { Injectable } from '@nestjs/common';
import { DocumentNumbering } from '../../../shared/infrastructure/database/numbering';
import { Clock } from '../../../shared/kernel/clock';
import { InvariantViolationError, NotFoundError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { DEFAULT_TIMEZONE, toLocalDate } from '../../../shared/kernel/time';
import { Locale, translate } from '../../../shared/kernel/translatable';
import { BranchDirectory, BranchInfo, LegalEntityDirectory, StaffDirectory } from '../../identity/public';
import { BanquetRequest } from '../domain/banquet-request';
import { yearOf } from '../domain/dates';
import { SellerSnapshot } from '../domain/requisites';
import { InvoiceRepository } from '../infrastructure/invoice.repository';
import { QuoteRecord, QuoteRepository } from '../infrastructure/quote.repository';
import { RequestRepository } from '../infrastructure/request.repository';

/** Нумерация документов модуля: последовательность в разрезе филиала и года, префикс «<код филиала>-<буква>». */
export const NUMBERING = {
  request: { scope: 'banquet', suffix: 'B' },
  contract: { scope: 'banquet_contract', suffix: 'D' },
  invoice: { scope: 'banquet_invoice', suffix: 'S' },
  act: { scope: 'banquet_act', suffix: 'A' },
} as const;
export type NumberedDocument = keyof typeof NUMBERING;

/**
 * Общие операции действий модуля: загрузка заявки, филиал нумерации (выезд без филиала — филиал по умолчанию),
 * реквизиты продавца, актуальная смета, сумма оплат, локальная дата.
 */
@Injectable()
export class BanquetSupport {
  constructor(
    private readonly requests: RequestRepository,
    private readonly quotes: QuoteRepository,
    private readonly invoices: InvoiceRepository,
    private readonly branches: BranchDirectory,
    private readonly legalEntities: LegalEntityDirectory,
    private readonly staff: StaffDirectory,
    private readonly numbering: DocumentNumbering,
    private readonly clock: Clock,
  ) {}

  async load(id: string, options: { forUpdate?: boolean } = {}): Promise<BanquetRequest> {
    const request = await this.requests.findById(id, options);
    if (!request) throw new NotFoundError('banquet_request', id);
    return request;
  }

  async timezoneOf(branchId: string | null): Promise<string> {
    if (!branchId) return DEFAULT_TIMEZONE;
    return (await this.branches.find(branchId))?.timezone ?? DEFAULT_TIMEZONE;
  }

  /** Сегодняшняя дата в часовом поясе филиала (Asia/Almaty по умолчанию). */
  async today(branchId: string | null): Promise<string> {
    return toLocalDate(this.clock.now(), await this.timezoneOf(branchId));
  }

  /** Филиал проведения/исполнитель или филиал по умолчанию (первый активный) — для нумерации выездов. */
  async numberingBranch(branchId: string | null): Promise<BranchInfo> {
    if (branchId) return this.branches.get(branchId);
    const active = await this.branches.list({ activeOnly: true });
    const all = active.length > 0 ? active : await this.branches.list();
    const sorted = [...all].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    if (!sorted[0]) throw new InvariantViolationError('banquet.no_branches', 'No branches configured');
    return sorted[0];
  }

  /** Следующий номер документа: GL-B-2026-000001 (заявка), GL-S-… (счёт), GL-D-… (договор), GL-A-… (акт). */
  async nextNumber(kind: NumberedDocument, branchId: string | null): Promise<{ number: string; numberingBranchId: string }> {
    const branch = await this.numberingBranch(branchId);
    const year = yearOf(toLocalDate(this.clock.now(), branch.timezone));
    const { scope, suffix } = NUMBERING[kind];
    const value = await this.numbering.next(scope, branch.id, year);
    return { number: DocumentNumbering.format(`${branch.code}-${suffix}`, year, value), numberingBranchId: branch.id };
  }

  /** Реквизиты юрлица-продавца филиала (или юрлица по умолчанию) — снимок для документа. */
  async seller(branchId: string | null): Promise<SellerSnapshot> {
    const e = await this.legalEntities.forBranch(branchId);
    return {
      name: e.name,
      shortName: e.shortName,
      bin: e.bin,
      legalAddress: e.legalAddress,
      actualAddress: e.actualAddress,
      directorName: e.directorName,
      directorPosition: e.directorPosition,
      actingBasis: e.actingBasis,
      bankName: e.bankName,
      iban: e.iban,
      bik: e.bik,
      kbe: e.kbe,
      vatPayer: e.vatPayer,
      vatRateBp: e.vatPayer ? e.vatRateBp : 0,
      vatCertificate: e.vatCertificate,
      phone: e.phone,
      email: e.email,
    };
  }

  async manager(managerId: string): Promise<{ id: string; name: string; phone: string | null; email: string | null }> {
    const m = await this.staff.get(managerId);
    return { id: managerId, name: m?.name ?? '—', phone: m?.phone ?? null, email: m?.email ?? null };
  }

  /** Актуальная смета: последняя согласованная клиентом версия, иначе последняя версия. */
  async currentQuote(requestId: string): Promise<QuoteRecord | null> {
    return (await this.quotes.latestAccepted(requestId)) ?? (await this.quotes.latest(requestId));
  }

  /** Получено по всем действующим счетам заявки за вычетом возвратов. */
  async paidNet(requestId: string): Promise<Money> {
    const invoices = await this.invoices.listForRequest(requestId);
    return Money.sum(invoices.map((i) => i.paid.subtract(i.refunded)));
  }

  /** Место проведения для документов и сообщений: филиал (название, адрес) или адрес выезда. */
  async placeLabel(request: BanquetRequest, locale: Locale): Promise<string> {
    const s = request.snapshot();
    if (s.isOffsite) return `Выезд: ${s.offsiteAddress ?? ''}`;
    const branch = s.branchId ? await this.branches.find(s.branchId) : null;
    return branch ? `${translate(branch.name, locale)}, ${translate(branch.address, locale)}` : '';
  }

  async branchName(branchId: string | null, locale: Locale): Promise<string | null> {
    if (!branchId) return null;
    const branch = await this.branches.find(branchId);
    return branch ? translate(branch.name, locale) : null;
  }
}
