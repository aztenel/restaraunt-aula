import { Injectable } from '@nestjs/common';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { Database } from '../../../shared/infrastructure/database/database';
import { PdfRenderer } from '../../../shared/infrastructure/pdf/pdf-renderer';
import { FileStorage } from '../../../shared/infrastructure/storage/file-storage';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { newId } from '../../../shared/kernel/ids';
import { toLocalDate } from '../../../shared/kernel/time';
import { translate } from '../../../shared/kernel/translatable';
import { VenueAvailability } from '../../reservation/public';
import { eventTypeLabel } from '../domain/texts';
import { DocumentKind, DocumentRecord, DocumentRepository } from '../infrastructure/document.repository';
import { InvoiceRecord, InvoiceRepository } from '../infrastructure/invoice.repository';
import { QuoteRecord, QuoteRepository } from '../infrastructure/quote.repository';
import { BanquetSupport } from './banquet-support';
import { invoicePdf, quotePdf } from './documents/pdf-documents';
import { CompanyRepository } from '../infrastructure/company.repository';

/** Ссылка на приватный файл живёт час (админка), для гостя — сутки. */
export const ADMIN_LINK_TTL_SECONDS = 3600;
export const GUEST_LINK_TTL_SECONDS = 24 * 3600;

export interface SignedLink {
  url: string;
  expiresAt: Date;
  filename: string;
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_');
}

/**
 * Файлы документов заявки: приватное хранилище (FileStorage), запись в списке документов,
 * подписанные ссылки на скачивание. PDF сметы и счёта создаются при первом запросе (версии неизменяемы).
 */
@Injectable()
export class BanquetDocumentFiles {
  constructor(
    private readonly storage: FileStorage,
    private readonly pdf: PdfRenderer,
    private readonly documents: DocumentRepository,
    private readonly quotes: QuoteRepository,
    private readonly invoices: InvoiceRepository,
    private readonly companies: CompanyRepository,
    private readonly venues: VenueAvailability,
    private readonly support: BanquetSupport,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  /** Сохранить файл документа и запись о нём (в текущей транзакции, если она есть). */
  async store(input: {
    requestId: string;
    kind: DocumentKind;
    number: string | null;
    title: string;
    relatedId: string | null;
    body: Buffer;
    contentType: string;
    extension: string;
    actor: Actor;
  }): Promise<DocumentRecord> {
    const id = newId();
    const filename = `${safeName(input.number ?? input.kind)}.${input.extension}`;
    const fileKey = `banquet/${input.requestId}/${input.kind}-${safeName(input.number ?? 'doc')}-${id}.${input.extension}`;
    await this.storage.put({ key: fileKey, body: input.body, contentType: input.contentType, visibility: 'private' });
    const record: DocumentRecord = {
      id,
      requestId: input.requestId,
      kind: input.kind,
      number: input.number,
      title: input.title,
      relatedId: input.relatedId,
      fileKey,
      filename,
      contentType: input.contentType,
      createdBy: input.actor.userId,
      createdByName: input.actor.name,
      createdAt: this.clock.now(),
    };
    await this.documents.insert(record);
    return record;
  }

  async renderPdf(definition: TDocumentDefinitions): Promise<Buffer> {
    return this.pdf.render(definition);
  }

  async link(fileKey: string, filename: string, ttlSeconds = ADMIN_LINK_TTL_SECONDS): Promise<SignedLink> {
    const url = await this.storage.signedUrl(fileKey, ttlSeconds, filename);
    return { url, expiresAt: new Date(this.clock.now().getTime() + ttlSeconds * 1000), filename };
  }

  /** PDF версии сметы (создаётся один раз). */
  async ensureQuotePdf(quote: QuoteRecord, actor: Actor): Promise<{ fileKey: string; filename: string }> {
    const request = await this.support.load(quote.requestId);
    const s = request.snapshot();
    const filename = `${safeName(s.number)}-v${quote.version}.pdf`;
    if (quote.pdfFileKey) return { fileKey: quote.pdfFileKey, filename };
    const manager = await this.support.manager(s.managerId);
    const company = s.companyId ? await this.companies.findById(s.companyId) : null;
    let venue: string | null = null;
    if (s.venue) {
      try {
        venue = translate((await this.venues.getVenue(s.venue.venueId)).name, s.locale);
      } catch {
        venue = null;
      }
    }
    const body = await this.pdf.render(
      quotePdf({
        locale: s.locale,
        requestNumber: s.number,
        quote,
        client: { name: s.contact.name, phone: s.contact.phone || null, email: s.contact.email, company: company?.name ?? null },
        event: {
          date: s.eventDate,
          time: s.eventTime,
          typeLabel: eventTypeLabel(s.eventType, s.locale),
          guests: s.guests,
          place: await this.support.placeLabel(request, s.locale),
          venue,
        },
        manager,
      }),
    );
    return this.database.transaction(async () => {
      await this.database.advisoryLock('banquet.quote_pdf', quote.id);
      const fresh = await this.quotes.findById(quote.id);
      if (fresh?.pdfFileKey) return { fileKey: fresh.pdfFileKey, filename };
      const doc = await this.store({
        requestId: s.id,
        kind: 'quote',
        number: `${s.number}-v${quote.version}`,
        title: `Смета, версия ${quote.version}`,
        relatedId: quote.id,
        body,
        contentType: 'application/pdf',
        extension: 'pdf',
        actor,
      });
      await this.quotes.setPdf(quote.id, doc.fileKey);
      return { fileKey: doc.fileKey, filename };
    });
  }

  /** PDF счёта на оплату (с реквизитами продавца и покупателя). */
  async ensureInvoicePdf(invoice: InvoiceRecord, actor: Actor): Promise<{ fileKey: string; filename: string }> {
    const filename = `${safeName(invoice.number)}.pdf`;
    if (invoice.pdfFileKey) return { fileKey: invoice.pdfFileKey, filename };
    const request = await this.support.load(invoice.requestId);
    const s = request.snapshot();
    const tz = await this.support.timezoneOf(invoice.branchId);
    const body = await this.pdf.render(
      invoicePdf({
        number: invoice.number,
        issuedDate: toLocalDate(invoice.issuedAt, tz),
        dueDate: invoice.dueDate,
        seller: invoice.seller,
        buyer: invoice.buyer,
        description: invoice.description,
        amount: invoice.amount,
        vat: invoice.vat,
        vatRateBp: invoice.vatRateBp,
        contract: s.contractNumber && s.contractDate ? { number: s.contractNumber, date: s.contractDate } : null,
      }),
    );
    return this.database.transaction(async () => {
      await this.database.advisoryLock('banquet.invoice_pdf', invoice.id);
      const fresh = await this.invoices.findById(invoice.id);
      if (fresh?.pdfFileKey) return { fileKey: fresh.pdfFileKey, filename };
      const doc = await this.store({
        requestId: s.id,
        kind: 'invoice',
        number: invoice.number,
        title: `Счёт на оплату № ${invoice.number}`,
        relatedId: invoice.id,
        body,
        contentType: 'application/pdf',
        extension: 'pdf',
        actor,
      });
      await this.invoices.setPdf(invoice.id, doc.fileKey);
      return { fileKey: doc.fileKey, filename };
    });
  }
}
