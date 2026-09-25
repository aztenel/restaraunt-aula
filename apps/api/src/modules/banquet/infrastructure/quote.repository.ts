import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';
import { Currency, Money } from '../../../shared/kernel/money';
import { Translatable } from '../../../shared/kernel/translatable';
import { CalculatedQuoteLine, QuoteDiscount, QuoteTotals } from '../domain/quote';
import { SellerSnapshot } from '../domain/requisites';
import { QuoteLineKind } from '../domain/texts';
import { BanquetTables, QuoteLinesTable, QuotesTable } from './banquet.tables';

export interface QuoteLineRecord extends CalculatedQuoteLine {
  id: string;
}

/** Версия сметы. После сохранения не меняется (кроме отметок PDF / отправки / согласования). */
export interface QuoteRecord {
  id: string;
  requestId: string;
  version: number;
  branchId: string | null;
  guests: number;
  discount: QuoteDiscount;
  serviceChargeBp: number;
  vat: { payer: boolean; rateBp: number };
  lines: QuoteLineRecord[];
  totals: QuoteTotals;
  validUntil: string | null;
  notes: string | null;
  seller: SellerSnapshot;
  pdfFileKey: string | null;
  createdBy: string | null;
  createdByName: string;
  createdAt: Date;
  sentAt: Date | null;
  acceptedAt: Date | null;
}

export type QuoteSummary = Omit<QuoteRecord, 'lines'> & { linesCount: number };

function m(amount: number, currency: string): Money {
  return Money.of(amount, currency as Currency);
}

function discountOf(type: string | null, bp: number | null, amount: number | null, currency: string): QuoteDiscount {
  if (type === 'percent') return { type: 'percent', bp: bp ?? 0 };
  if (type === 'amount') return { type: 'amount', amount: m(amount ?? 0, currency) };
  return null;
}

function discountColumns(d: QuoteDiscount) {
  return {
    discount_type: d?.type ?? null,
    discount_bp: d?.type === 'percent' ? d.bp : null,
    discount_value_amount: d?.type === 'amount' ? d.amount.amount : null,
    discount_value_currency: d?.type === 'amount' ? d.amount.currency : 'KZT',
  };
}

function mapLine(r: Selectable<QuoteLinesTable>): QuoteLineRecord {
  return {
    id: r.id,
    position: r.position,
    kind: r.kind as QuoteLineKind,
    dishId: r.dish_id,
    title: r.title as Translatable,
    unit: r.unit,
    quantity: r.quantity,
    unitPrice: m(r.unit_price_amount, r.unit_price_currency),
    discount: discountOf(r.discount_type, r.discount_bp, r.discount_value_amount, r.discount_value_currency),
    gross: m(r.gross_amount, r.gross_currency),
    discountAmount: m(r.discount_amount, r.discount_currency),
    total: m(r.total_amount, r.total_currency),
  };
}

function mapQuote(r: Selectable<QuotesTable>, lines: QuoteLineRecord[] | null): QuoteRecord {
  const subtotal = m(r.subtotal_amount, r.subtotal_currency);
  const discount = m(r.discount_amount, r.discount_currency);
  const linesDiscount = lines ? Money.sum(lines.map((l) => l.discountAmount), subtotal.currency) : Money.zero(subtotal.currency);
  return {
    id: r.id,
    requestId: r.request_id,
    version: r.version,
    branchId: r.branch_id,
    guests: r.guests,
    discount: discountOf(r.discount_type, r.discount_bp, r.discount_value_amount, r.discount_value_currency),
    serviceChargeBp: r.service_charge_bp,
    vat: { payer: r.vat_payer, rateBp: r.vat_rate_bp },
    lines: lines ?? [],
    totals: {
      subtotal,
      discount,
      linesDiscount,
      overallDiscount: discount.subtract(linesDiscount),
      afterDiscount: subtotal.subtract(discount),
      service: m(r.service_amount, r.service_currency),
      total: m(r.total_amount, r.total_currency),
      vat: m(r.vat_amount, r.vat_currency),
      perGuest: m(r.per_guest_amount, r.per_guest_currency),
    },
    validUntil: r.valid_until,
    notes: r.notes,
    seller: r.seller as SellerSnapshot,
    pdfFileKey: r.pdf_file_key,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    acceptedAt: r.accepted_at,
  };
}

@Injectable()
export class QuoteRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<BanquetTables>();
  }

  /** Следующий номер версии (вызывать под блокировкой заявки). */
  async nextVersion(requestId: string): Promise<number> {
    const row = await this.db()
      .selectFrom('banquet.quotes')
      .select((eb) => eb.fn.max<number>('version').as('v'))
      .where('request_id', '=', requestId)
      .executeTakeFirst();
    return Number(row?.v ?? 0) + 1;
  }

  async insert(q: Omit<QuoteRecord, 'lines' | 'pdfFileKey' | 'sentAt' | 'acceptedAt'> & { lines: CalculatedQuoteLine[] }): Promise<void> {
    await this.db()
      .insertInto('banquet.quotes')
      .values({
        id: q.id,
        request_id: q.requestId,
        version: q.version,
        branch_id: q.branchId,
        guests: q.guests,
        ...discountColumns(q.discount),
        service_charge_bp: q.serviceChargeBp,
        vat_payer: q.vat.payer,
        vat_rate_bp: q.vat.rateBp,
        subtotal_amount: q.totals.subtotal.amount,
        subtotal_currency: q.totals.subtotal.currency,
        discount_amount: q.totals.discount.amount,
        discount_currency: q.totals.discount.currency,
        service_amount: q.totals.service.amount,
        service_currency: q.totals.service.currency,
        total_amount: q.totals.total.amount,
        total_currency: q.totals.total.currency,
        vat_amount: q.totals.vat.amount,
        vat_currency: q.totals.vat.currency,
        per_guest_amount: q.totals.perGuest.amount,
        per_guest_currency: q.totals.perGuest.currency,
        valid_until: q.validUntil,
        notes: q.notes,
        seller: JSON.stringify(q.seller),
        pdf_file_key: null,
        created_by: q.createdBy,
        created_by_name: q.createdByName,
        created_at: q.createdAt,
        sent_at: null,
        accepted_at: null,
      })
      .execute();
    await this.db()
      .insertInto('banquet.quote_lines')
      .values(
        q.lines.map((l) => ({
          id: newId(),
          quote_id: q.id,
          position: l.position,
          kind: l.kind,
          dish_id: l.dishId,
          title: JSON.stringify(l.title),
          unit: l.unit,
          quantity: l.quantity,
          unit_price_amount: l.unitPrice.amount,
          unit_price_currency: l.unitPrice.currency,
          ...discountColumns(l.discount),
          gross_amount: l.gross.amount,
          gross_currency: l.gross.currency,
          discount_amount: l.discountAmount.amount,
          discount_currency: l.discountAmount.currency,
          total_amount: l.total.amount,
          total_currency: l.total.currency,
        })),
      )
      .execute();
  }

  private async linesOf(quoteId: string): Promise<QuoteLineRecord[]> {
    const rows = await this.db().selectFrom('banquet.quote_lines').selectAll().where('quote_id', '=', quoteId).orderBy('position').execute();
    return rows.map(mapLine);
  }

  async findById(id: string): Promise<QuoteRecord | null> {
    const row = await this.db().selectFrom('banquet.quotes').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? mapQuote(row, await this.linesOf(row.id)) : null;
  }

  async latest(requestId: string): Promise<QuoteRecord | null> {
    const row = await this.db()
      .selectFrom('banquet.quotes')
      .selectAll()
      .where('request_id', '=', requestId)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? mapQuote(row, await this.linesOf(row.id)) : null;
  }

  async latestSent(requestId: string): Promise<QuoteRecord | null> {
    const row = await this.db()
      .selectFrom('banquet.quotes')
      .selectAll()
      .where('request_id', '=', requestId)
      .where('sent_at', 'is not', null)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? mapQuote(row, await this.linesOf(row.id)) : null;
  }

  /** Последняя согласованная клиентом версия. */
  async latestAccepted(requestId: string): Promise<QuoteRecord | null> {
    const row = await this.db()
      .selectFrom('banquet.quotes')
      .selectAll()
      .where('request_id', '=', requestId)
      .where('accepted_at', 'is not', null)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? mapQuote(row, await this.linesOf(row.id)) : null;
  }

  async listVersions(requestId: string): Promise<QuoteSummary[]> {
    const rows = await this.db()
      .selectFrom('banquet.quotes')
      .selectAll()
      .select((eb) =>
        eb.selectFrom('banquet.quote_lines').select((e) => e.fn.countAll<number>().as('n')).whereRef('quote_id', '=', 'banquet.quotes.id').as('lines_count'),
      )
      .where('request_id', '=', requestId)
      .orderBy('version', 'desc')
      .execute();
    return rows.map((r) => {
      const { lines: _lines, ...rest } = mapQuote(r, null);
      return { ...rest, linesCount: Number(r.lines_count ?? 0) };
    });
  }

  /** Итоги последних версий по заявкам (списки, события). */
  async latestTotals(requestIds: string[]): Promise<Map<string, { version: number; total: Money }>> {
    if (requestIds.length === 0) return new Map();
    const rows = await this.db()
      .selectFrom('banquet.quotes')
      .select(['request_id', 'version', 'total_amount', 'total_currency'])
      .distinctOn('request_id')
      .where('request_id', 'in', requestIds)
      .orderBy('request_id')
      .orderBy('version', 'desc')
      .execute();
    return new Map(rows.map((r) => [r.request_id, { version: r.version, total: m(r.total_amount, r.total_currency) }]));
  }

  async markSent(id: string, at: Date): Promise<void> {
    await this.db().updateTable('banquet.quotes').set({ sent_at: at }).where('id', '=', id).execute();
  }

  async markAccepted(id: string, at: Date): Promise<void> {
    await this.db().updateTable('banquet.quotes').set({ accepted_at: at }).where('id', '=', id).execute();
  }

  async setPdf(id: string, fileKey: string): Promise<void> {
    await this.db().updateTable('banquet.quotes').set({ pdf_file_key: fileKey }).where('id', '=', id).execute();
  }
}
