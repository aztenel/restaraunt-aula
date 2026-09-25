import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus, JobQueue } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { Permission } from '../../../shared/kernel/permissions';
import { translate } from '../../../shared/kernel/translatable';
import { VenueAvailability } from '../../reservation/public';
import { BanquetRequest } from '../domain/banquet-request';
import { renderContract } from '../domain/contract-template';
import { EsfStatus, esfRequired } from '../domain/esf';
import { BuyerSnapshot, buyerFromCompany, buyerFromContact } from '../domain/requisites';
import { eventTypeLabel } from '../domain/texts';
import { ActivityRepository } from '../infrastructure/activity.repository';
import { CompanyRepository } from '../infrastructure/company.repository';
import { ActRecord, DocumentRecord, DocumentRepository } from '../infrastructure/document.repository';
import { RequestRepository } from '../infrastructure/request.repository';
import { TemplateRepository } from '../infrastructure/template.repository';
import { BanquetActIssuedPayload, BanquetEvents } from '../public';
import { assertCanManage } from './access';
import { BanquetSupport } from './banquet-support';
import { BanquetDocumentFiles } from './document-files';
import { actPdf, contractPdf } from './documents/pdf-documents';

export const BanquetJobs = {
  EsfSubmit: 'banquet.esf_submit',
  EsfCheck: 'banquet.esf_check',
} as const;

export interface EsfJobPayload {
  actId: string;
}

/** Документы для юрлиц ведут банкетные менеджеры (banquets.manage) и финансы (banquets.invoice). */
export function assertCanIssueDocuments(actor: Actor, request: BanquetRequest): void {
  if (actor.can(Permission.BanquetsInvoice, request.branchId)) return;
  actor.assertCan(Permission.BanquetsManage, request.branchId);
}

async function buyerOf(companies: CompanyRepository, request: BanquetRequest): Promise<BuyerSnapshot> {
  const s = request.snapshot();
  if (s.companyId) {
    const company = await companies.findById(s.companyId);
    if (company) return buyerFromCompany(company.id, company, request.contact());
  }
  return buyerFromContact(request.contact());
}

/**
 * Договор по шаблону с подстановкой реквизитов продавца и заказчика, параметров мероприятия и сметы.
 * Номер договора выдаётся один раз (последовательность филиала и года), повторная генерация —
 * новая редакция файла с тем же номером.
 */
@Injectable()
export class GenerateContract {
  constructor(
    private readonly requests: RequestRepository,
    private readonly templates: TemplateRepository,
    private readonly companies: CompanyRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly files: BanquetDocumentFiles,
    private readonly venues: VenueAvailability,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, requestId: string, input: { templateId?: string | null }): Promise<DocumentRecord> {
    return this.database.transaction(async () => {
      const request = await this.support.load(requestId, { forUpdate: true });
      assertCanIssueDocuments(actor, request);
      if (request.status === 'cancelled') throw new ConflictError('banquet.request_closed', 'Request is cancelled');
      const template = input.templateId ? await this.templates.findById(input.templateId) : await this.templates.findDefault();
      if (!template) throw new NotFoundError('banquet_contract_template', input.templateId ?? 'default');
      const s = request.snapshot();
      const now = this.clock.now();
      const today = await this.support.today(s.branchId);
      let number = s.contractNumber;
      let date = s.contractDate;
      if (!number || !date) {
        number = (await this.support.nextNumber('contract', s.branchId)).number;
        date = today;
        request.setContract(number, date);
        await this.requests.save(request);
      }
      const quote = await this.support.currentQuote(requestId);
      const manager = await this.support.manager(s.managerId);
      const seller = await this.support.seller(s.branchId);
      const client = await buyerOf(this.companies, request);
      const venueName = s.venue ? translate((await this.venues.getVenue(s.venue.venueId)).name, 'ru') : null;
      const text = renderContract(template.body, {
        contract: { number, date },
        requestNumber: s.number,
        seller,
        client,
        event: {
          date: s.eventDate,
          time: s.eventTime,
          typeLabel: eventTypeLabel(s.eventType, 'ru'),
          guests: s.guests,
          place: await this.support.placeLabel(request, 'ru'),
          venue: venueName,
        },
        quote: quote ? { version: quote.version, total: quote.totals.total, vat: quote.totals.vat, perGuest: quote.totals.perGuest } : null,
        prepayment: request.requiredPrepayment(quote?.totals.total ?? null),
        manager: { name: manager.name, phone: manager.phone },
      });
      const body = await this.files.renderPdf(contractPdf({ number, date, text, seller, client }));
      const doc = await this.files.store({
        requestId,
        kind: 'contract',
        number,
        title: `Договор № ${number}`,
        relatedId: template.id,
        body,
        contentType: 'application/pdf',
        extension: 'pdf',
        actor,
      });
      await this.activities.add({
        requestId,
        kind: 'document_generated',
        data: { documentId: doc.id, kind: 'contract', number, templateId: template.id },
        actor,
        at: now,
      });
      await this.audit.record({
        action: 'banquet.contract_generated',
        entityType: 'banquet_request',
        entityId: requestId,
        branchId: s.branchId,
        after: { documentId: doc.id, number, date, templateId: template.id, quoteVersion: quote?.version ?? null },
        meta: { number: s.number },
        actor,
      });
      return doc;
    });
  }
}

/**
 * Акт выполненных работ после проведения банкета (held): номер в разрезе филиала и года, PDF,
 * событие ActIssued. Для юрлица при продавце — плательщике НДС ставится задача ЭСФ.
 */
@Injectable()
export class IssueBanquetAct {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly documents: DocumentRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly files: BanquetDocumentFiles,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: EventBus,
    private readonly jobs: JobQueue,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, requestId: string): Promise<ActRecord> {
    return this.database.transaction(async () => {
      const request = await this.support.load(requestId, { forUpdate: true });
      assertCanIssueDocuments(actor, request);
      if (request.status !== 'held') throw new ConflictError('banquet_act.request_not_held', 'Act is issued after the banquet is held', { status: request.status });
      if (await this.documents.actOfRequest(requestId)) throw new ConflictError('banquet_act.already_issued', 'Act has already been issued');
      const quote = await this.support.currentQuote(requestId);
      if (!quote) throw new ConflictError('banquet_act.no_quote', 'Request has no quote');
      const s = request.snapshot();
      const now = this.clock.now();
      const actDate = await this.support.today(s.branchId);
      const seller = await this.support.seller(s.branchId);
      const buyer = await buyerOf(this.companies, request);
      const amount = quote.totals.total;
      const vat = seller.vatPayer ? amount.includedTax(seller.vatRateBp) : Money.zero(amount.currency);
      const { number } = await this.support.nextNumber('act', s.branchId);
      const contract = s.contractNumber && s.contractDate ? { number: s.contractNumber, date: s.contractDate } : null;
      const body = await this.files.renderPdf(
        actPdf({
          number,
          date: actDate,
          requestNumber: s.number,
          eventDate: s.eventDate,
          seller,
          buyer,
          lines: quote.lines,
          quote,
          amount,
          vat,
          vatRateBp: seller.vatPayer ? seller.vatRateBp : 0,
          contract,
        }),
      );
      const id = newId();
      const doc = await this.files.store({
        requestId,
        kind: 'act',
        number,
        title: `Акт выполненных работ № ${number}`,
        relatedId: id,
        body,
        contentType: 'application/pdf',
        extension: 'pdf',
        actor,
      });
      const needsEsf = esfRequired(seller, buyer);
      const act: ActRecord = {
        id,
        requestId,
        number,
        branchId: s.branchId,
        quoteId: quote.id,
        payerType: buyer.type,
        companyId: buyer.companyId,
        buyer,
        seller,
        amount,
        vat,
        vatRateBp: seller.vatPayer ? seller.vatRateBp : 0,
        actDate,
        pdfFileKey: doc.fileKey,
        esf: {
          status: needsEsf ? EsfStatus.Pending : EsfStatus.NotRequired,
          provider: null,
          esfId: null,
          registrationNumber: null,
          error: null,
          fileKey: null,
          updatedAt: now,
        },
        createdBy: actor.userId,
        createdByName: actor.name,
        createdAt: now,
      };
      await this.documents.insertAct(act);
      await this.activities.add({
        requestId,
        kind: 'act_issued',
        data: { actId: id, number, amount: amount.toJSON(), vat: vat.toJSON(), esf: act.esf.status },
        actor,
        at: now,
      });
      await this.audit.record({
        action: 'banquet.act_issued',
        entityType: 'banquet_act',
        entityId: id,
        branchId: s.branchId,
        after: { number, amount: amount.toJSON(), vat: vat.toJSON(), payerType: buyer.type, esfStatus: act.esf.status },
        meta: { requestId, requestNumber: s.number },
        actor,
      });
      const payload: BanquetActIssuedPayload = {
        actId: id,
        number,
        requestId,
        branchId: s.branchId,
        amount: amount.toJSON(),
        vatAmount: vat.toJSON(),
        company: buyer.type === 'company' ? { name: buyer.name, bin: buyer.bin ?? '' } : null,
        occurredAt: now.toISOString(),
      };
      await this.events.publish(BanquetEvents.ActIssued, payload, { aggregateId: requestId, branchId: s.branchId });
      if (needsEsf) {
        await this.jobs.enqueue(BanquetJobs.EsfSubmit, { actId: id } satisfies EsfJobPayload, { aggregateId: id, branchId: s.branchId });
      }
      return act;
    });
  }
}

/** Проверка права на заявку для запросов документов (используется контроллерами через запросы). */
export function assertCanManageRequest(actor: Actor, request: BanquetRequest): void {
  assertCanManage(actor, request);
}
