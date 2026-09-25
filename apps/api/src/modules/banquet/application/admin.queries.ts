import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError } from '../../../shared/kernel/errors';
import { MoneyJson } from '../../../shared/kernel/money';
import { Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { Permission } from '../../../shared/kernel/permissions';
import { toLocalDate } from '../../../shared/kernel/time';
import { Translatable } from '../../../shared/kernel/translatable';
import { MenuQuery } from '../../catalog/public';
import { CONTRACT_PLACEHOLDERS } from '../domain/contract-template';
import { InvoiceStatus } from '../domain/invoice';
import { ClientCompanyRecord, CompanyRepository } from '../infrastructure/company.repository';
import { DocumentRepository } from '../infrastructure/document.repository';
import { InvoiceRepository } from '../infrastructure/invoice.repository';
import { QuoteRepository } from '../infrastructure/quote.repository';
import { RequestRepository } from '../infrastructure/request.repository';
import { ContractTemplateRecord, TemplateRepository } from '../infrastructure/template.repository';
import { assertCanView } from './access';
import { BanquetLinks } from './banquet-links';
import { BanquetSupport } from './banquet-support';
import { BanquetDocumentFiles, SignedLink } from './document-files';
import { DocumentView, documentView, InvoiceView, invoiceView, QuoteSummaryView, quoteSummaryView, QuoteView, quoteView } from './views';

export interface DishOptionView {
  dishId: string;
  name: Translatable;
  price: MoneyJson;
  availability: string;
  photoUrl: string | null;
  weightGrams: number | null;
}

/** Версии смет, PDF, поиск блюд меню филиала для конструктора сметы. */
@Injectable()
export class QuoteQueries {
  constructor(
    private readonly quotes: QuoteRepository,
    private readonly requests: RequestRepository,
    private readonly files: BanquetDocumentFiles,
    private readonly support: BanquetSupport,
    private readonly menu: MenuQuery,
  ) {}

  async versions(actor: Actor, requestId: string): Promise<QuoteSummaryView[]> {
    const request = await this.support.load(requestId);
    assertCanView(actor, request);
    const versions = await this.quotes.listVersions(requestId);
    const latest = versions[0]?.version ?? null;
    return versions.map((v) => quoteSummaryView(v, latest));
  }

  async get(actor: Actor, quoteId: string): Promise<QuoteView> {
    const quote = await this.quotes.findById(quoteId);
    if (!quote) throw new NotFoundError('banquet_quote', quoteId);
    assertCanView(actor, await this.support.load(quote.requestId));
    const latest = await this.quotes.latest(quote.requestId);
    return quoteView(quote, latest?.version ?? null);
  }

  async pdfLink(actor: Actor, quoteId: string): Promise<SignedLink> {
    const quote = await this.quotes.findById(quoteId);
    if (!quote) throw new NotFoundError('banquet_quote', quoteId);
    assertCanView(actor, await this.support.load(quote.requestId));
    const pdf = await this.files.ensureQuotePdf(quote, actor);
    return this.files.link(pdf.fileKey, pdf.filename);
  }

  /** Поиск блюд меню филиала: цена филиала на сейчас (в смету попадёт снимок). */
  async searchDishes(actor: Actor, branchId: string, query: string, limit = 20): Promise<DishOptionView[]> {
    actor.assertCan(Permission.BanquetsManage, branchId);
    const dishes = await this.menu.searchBranchDishes(branchId, query.trim(), Math.min(Math.max(limit, 1), 50));
    return dishes.map((d) => ({
      dishId: d.dishId,
      name: d.name,
      price: d.price.toJSON(),
      availability: d.availability,
      photoUrl: d.photoUrl,
      weightGrams: d.weightGrams,
    }));
  }
}

export interface InvoiceListItemView extends InvoiceView {
  requestNumber: string;
}

/** Счета: список для финансов (фильтры, просроченные), карточка, PDF. */
@Injectable()
export class InvoiceQueries {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly requests: RequestRepository,
    private readonly files: BanquetDocumentFiles,
    private readonly support: BanquetSupport,
    private readonly links: BanquetLinks,
    private readonly clock: Clock,
  ) {}

  async list(
    actor: Actor,
    query: { branchId?: string; status?: InvoiceStatus[]; overdue?: boolean },
    page: PageRequest,
  ): Promise<Page<InvoiceListItemView>> {
    const branches = actor.scopeBranches(Permission.BanquetsView, query.branchId ?? null);
    const today = toLocalDate(this.clock.now());
    const { items, total } = await this.invoices.list({ branches, statuses: query.status, overdueOn: query.overdue ? today : undefined }, page);
    const payments = await this.invoices.paymentsOf(items.map((i) => i.id));
    const requests = new Map((await this.requests.findByIds([...new Set(items.map((i) => i.requestId))])).map((r) => [r.id, r]));
    return pageOf(
      items.map((i) => {
        const request = requests.get(i.requestId);
        return {
          ...invoiceView(i, payments, { today, publicUrl: this.links.invoice(i.publicToken, request?.snapshot().locale ?? 'ru') }),
          requestNumber: request?.number ?? '',
        };
      }),
      total,
      page,
    );
  }

  async get(actor: Actor, invoiceId: string): Promise<InvoiceListItemView> {
    const invoice = await this.invoices.findById(invoiceId);
    if (!invoice) throw new NotFoundError('banquet_invoice', invoiceId);
    const request = await this.support.load(invoice.requestId);
    assertCanView(actor, request);
    const today = await this.support.today(invoice.branchId);
    const payments = await this.invoices.paymentsOf([invoice.id]);
    return {
      ...invoiceView(invoice, payments, { today, publicUrl: this.links.invoice(invoice.publicToken, request.snapshot().locale) }),
      requestNumber: request.number,
    };
  }

  async pdfLink(actor: Actor, invoiceId: string): Promise<SignedLink> {
    const invoice = await this.invoices.findById(invoiceId);
    if (!invoice) throw new NotFoundError('banquet_invoice', invoiceId);
    assertCanView(actor, await this.support.load(invoice.requestId));
    const pdf = await this.files.ensureInvoicePdf(invoice, actor);
    return this.files.link(pdf.fileKey, pdf.filename);
  }
}

/** Документы заявки и подписанные ссылки на скачивание (файлы приватные). */
@Injectable()
export class DocumentQueries {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly files: BanquetDocumentFiles,
    private readonly support: BanquetSupport,
  ) {}

  async list(actor: Actor, requestId: string): Promise<DocumentView[]> {
    assertCanView(actor, await this.support.load(requestId));
    return (await this.documents.listForRequest(requestId)).map(documentView);
  }

  async link(actor: Actor, documentId: string): Promise<SignedLink> {
    const doc = await this.documents.findById(documentId);
    if (!doc) throw new NotFoundError('banquet_document', documentId);
    assertCanView(actor, await this.support.load(doc.requestId));
    return this.files.link(doc.fileKey, doc.filename);
  }
}

/** Справочник компаний-заказчиков: поиск по названию и БИН. */
@Injectable()
export class CompanyQueries {
  constructor(private readonly companies: CompanyRepository) {}

  private assertAccess(actor: Actor): void {
    if (actor.canSomewhere(Permission.BanquetsInvoice)) return;
    actor.assertCanSomewhere(Permission.BanquetsView);
  }

  async search(actor: Actor, query: string | undefined, page: PageRequest): Promise<Page<ClientCompanyRecord>> {
    this.assertAccess(actor);
    const { items, total } = await this.companies.search(query, page);
    return pageOf(items, total, page);
  }

  async get(actor: Actor, id: string): Promise<ClientCompanyRecord> {
    this.assertAccess(actor);
    const company = await this.companies.findById(id);
    if (!company) throw new NotFoundError('banquet_company', id);
    return company;
  }
}

/** Шаблоны договоров и перечень подстановок. */
@Injectable()
export class TemplateQueries {
  constructor(private readonly templates: TemplateRepository) {}

  async list(actor: Actor): Promise<ContractTemplateRecord[]> {
    actor.assertCanSomewhere(Permission.BanquetsView);
    return this.templates.list();
  }

  async get(actor: Actor, id: string): Promise<ContractTemplateRecord> {
    actor.assertCanSomewhere(Permission.BanquetsView);
    const template = await this.templates.findById(id);
    if (!template) throw new NotFoundError('banquet_contract_template', id);
    return template;
  }

  placeholders(): Array<{ key: string; description: string }> {
    return Object.entries(CONTRACT_PLACEHOLDERS).map(([key, description]) => ({ key, description }));
  }
}
