import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Currency, Money } from '../../../shared/kernel/money';
import { EsfStatus } from '../domain/esf';
import { PayerType } from '../domain/invoice';
import { BuyerSnapshot, SellerSnapshot } from '../domain/requisites';
import { ActsTable, BanquetTables, DocumentsTable } from './banquet.tables';

export const DOCUMENT_KINDS = ['quote', 'contract', 'invoice', 'act', 'esf_xml'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface DocumentRecord {
  id: string;
  requestId: string;
  kind: DocumentKind;
  number: string | null;
  title: string;
  relatedId: string | null;
  fileKey: string;
  filename: string;
  contentType: string;
  createdBy: string | null;
  createdByName: string;
  createdAt: Date;
}

export interface ActRecord {
  id: string;
  requestId: string;
  number: string;
  branchId: string | null;
  quoteId: string;
  payerType: PayerType;
  companyId: string | null;
  buyer: BuyerSnapshot;
  seller: SellerSnapshot;
  amount: Money;
  vat: Money;
  vatRateBp: number;
  actDate: string;
  pdfFileKey: string;
  esf: {
    status: EsfStatus;
    provider: string | null;
    esfId: string | null;
    registrationNumber: string | null;
    error: string | null;
    fileKey: string | null;
    updatedAt: Date | null;
  };
  createdBy: string | null;
  createdByName: string;
  createdAt: Date;
}

function mapDocument(r: Selectable<DocumentsTable>): DocumentRecord {
  return {
    id: r.id,
    requestId: r.request_id,
    kind: r.kind as DocumentKind,
    number: r.number,
    title: r.title,
    relatedId: r.related_id,
    fileKey: r.file_key,
    filename: r.filename,
    contentType: r.content_type,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
  };
}

function mapAct(r: Selectable<ActsTable>): ActRecord {
  return {
    id: r.id,
    requestId: r.request_id,
    number: r.number,
    branchId: r.branch_id,
    quoteId: r.quote_id,
    payerType: r.payer_type as PayerType,
    companyId: r.company_id,
    buyer: r.buyer as BuyerSnapshot,
    seller: r.seller as SellerSnapshot,
    amount: Money.of(r.amount_amount, r.amount_currency as Currency),
    vat: Money.of(r.vat_amount, r.vat_currency as Currency),
    vatRateBp: r.vat_rate_bp,
    actDate: r.act_date,
    pdfFileKey: r.pdf_file_key,
    esf: {
      status: r.esf_status as EsfStatus,
      provider: r.esf_provider,
      esfId: r.esf_id,
      registrationNumber: r.esf_registration_number,
      error: r.esf_error,
      fileKey: r.esf_file_key,
      updatedAt: r.esf_updated_at,
    },
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
  };
}

@Injectable()
export class DocumentRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<BanquetTables>();
  }

  async insert(d: DocumentRecord): Promise<void> {
    await this.db()
      .insertInto('banquet.documents')
      .values({
        id: d.id,
        request_id: d.requestId,
        kind: d.kind,
        number: d.number,
        title: d.title,
        related_id: d.relatedId,
        file_key: d.fileKey,
        filename: d.filename,
        content_type: d.contentType,
        created_by: d.createdBy,
        created_by_name: d.createdByName,
        created_at: d.createdAt,
      })
      .execute();
  }

  async findById(id: string): Promise<DocumentRecord | null> {
    const row = await this.db().selectFrom('banquet.documents').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? mapDocument(row) : null;
  }

  async findByRelated(relatedId: string, kind: DocumentKind): Promise<DocumentRecord | null> {
    const row = await this.db()
      .selectFrom('banquet.documents')
      .selectAll()
      .where('related_id', '=', relatedId)
      .where('kind', '=', kind)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? mapDocument(row) : null;
  }

  async listForRequest(requestId: string): Promise<DocumentRecord[]> {
    const rows = await this.db()
      .selectFrom('banquet.documents')
      .selectAll()
      .where('request_id', '=', requestId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return rows.map(mapDocument);
  }

  // ---------------------------------------------------------------- акты

  async insertAct(a: ActRecord): Promise<void> {
    await this.db()
      .insertInto('banquet.acts')
      .values({
        id: a.id,
        request_id: a.requestId,
        number: a.number,
        branch_id: a.branchId,
        quote_id: a.quoteId,
        payer_type: a.payerType,
        company_id: a.companyId,
        buyer: JSON.stringify(a.buyer),
        seller: JSON.stringify(a.seller),
        amount_amount: a.amount.amount,
        amount_currency: a.amount.currency,
        vat_amount: a.vat.amount,
        vat_currency: a.vat.currency,
        vat_rate_bp: a.vatRateBp,
        act_date: a.actDate,
        pdf_file_key: a.pdfFileKey,
        esf_status: a.esf.status,
        esf_provider: a.esf.provider,
        esf_id: a.esf.esfId,
        esf_registration_number: a.esf.registrationNumber,
        esf_error: a.esf.error,
        esf_file_key: a.esf.fileKey,
        esf_updated_at: a.esf.updatedAt,
        created_by: a.createdBy,
        created_by_name: a.createdByName,
      })
      .execute();
  }

  async findAct(id: string, options: { forUpdate?: boolean } = {}): Promise<ActRecord | null> {
    let q = this.db().selectFrom('banquet.acts').selectAll().where('id', '=', id);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? mapAct(row) : null;
  }

  async actOfRequest(requestId: string): Promise<ActRecord | null> {
    const row = await this.db().selectFrom('banquet.acts').selectAll().where('request_id', '=', requestId).executeTakeFirst();
    return row ? mapAct(row) : null;
  }

  async updateEsf(actId: string, esf: Partial<ActRecord['esf']> & { updatedAt: Date }): Promise<void> {
    await this.db()
      .updateTable('banquet.acts')
      .set({
        ...(esf.status !== undefined ? { esf_status: esf.status } : {}),
        ...(esf.provider !== undefined ? { esf_provider: esf.provider } : {}),
        ...(esf.esfId !== undefined ? { esf_id: esf.esfId } : {}),
        ...(esf.registrationNumber !== undefined ? { esf_registration_number: esf.registrationNumber } : {}),
        ...(esf.error !== undefined ? { esf_error: esf.error } : {}),
        ...(esf.fileKey !== undefined ? { esf_file_key: esf.fileKey } : {}),
        esf_updated_at: esf.updatedAt,
      })
      .where('id', '=', actId)
      .execute();
  }
}
