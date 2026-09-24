import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { Money } from '../../../shared/kernel/money';
import {
  BanquetActIssuedPayload,
  BanquetEvents,
  BanquetInvoiceIssuedPayload,
  BanquetInvoicePaymentPayload,
  BanquetRequestAssignedPayload,
  BanquetRequestCreatedPayload,
  BanquetStatusChangedPayload,
} from '../../banquet/public';
import { RecognizeRefundRevenue } from '../application/recognize-refund-revenue.action';
import { banquetStageRank } from '../domain/banquet-funnel';
import { localDateOf } from '../domain/period';
import { BANQUET_STATUS_RANK, banquetSale } from '../domain/revenue';
import { BanquetFactsRepository, BanquetIdentity } from '../infrastructure/banquet-facts.repository';
import { PaymentFactsRepository } from '../infrastructure/payment-facts.repository';
import { SalesFactsRepository } from '../infrastructure/sales-facts.repository';

function identity(p: {
  requestId: string;
  number: string;
  branchId: string | null;
  isOffsite: boolean;
  eventDate: string;
  guests: number;
  managerId: string;
}): BanquetIdentity {
  return {
    requestId: p.requestId,
    number: p.number,
    branchId: p.branchId,
    isOffsite: p.isOffsite,
    eventDate: p.eventDate ? p.eventDate.slice(0, 10) : null,
    guests: p.guests,
    managerId: p.managerId,
  };
}

/**
 * Проекция банкетных заявок из событий Banquet: воронка, первый ответ (SLA 30 минут),
 * выручка при held (итог сметы), счета и акты для выгрузки в учёт.
 */
@Injectable()
export class BanquetProjectionHandler {
  constructor(
    private readonly banquets: BanquetFactsRepository,
    private readonly payments: PaymentFactsRepository,
    private readonly sales: SalesFactsRepository,
    private readonly recognizeRefund: RecognizeRefundRevenue,
  ) {}

  @OnEvent(BanquetEvents.RequestCreated)
  async onCreated(e: EventEnvelope<BanquetRequestCreatedPayload>): Promise<void> {
    const p = e.payload;
    const at = new Date(p.occurredAt);
    await this.banquets.applyCreated(
      identity(p),
      { status: 'new', at, rank: BANQUET_STATUS_RANK.new! },
      {
        eventType: p.eventType,
        budget: p.budget ? Money.fromJson(p.budget) : null,
        source: p.source,
        requestedAt: at,
        requestedDate: localDateOf(at),
      },
    );
  }

  @OnEvent(BanquetEvents.StatusChanged)
  async onStatusChanged(e: EventEnvelope<BanquetStatusChangedPayload>): Promise<void> {
    const p = e.payload;
    const at = new Date(p.occurredAt);
    const quoteTotal = p.quoteTotal ? Money.fromJson(p.quoteTotal) : null;
    await this.banquets.applyStatusChanged(e.id, identity(p), { status: p.to, at, rank: BANQUET_STATUS_RANK[p.to] ?? 0 }, {
      from: p.from,
      to: p.to,
      reason: p.reason,
      stage: banquetStageRank(p.to),
      quoteTotal,
      localDate: localDateOf(at),
    });
    if (p.to === 'held') {
      await this.sales.insert(banquetSale({ requestId: p.requestId, branchId: p.branchId, total: quoteTotal, heldAt: at }));
      await this.recognizeRefundsOf(p.requestId, await this.banquets.invoiceIdsOf(p.requestId));
    }
  }

  @OnEvent(BanquetEvents.RequestAssigned)
  async onAssigned(e: EventEnvelope<BanquetRequestAssignedPayload>): Promise<void> {
    await this.banquets.applyAssigned(e.payload.requestId, e.payload.managerId, new Date(e.payload.occurredAt));
  }

  @OnEvent(BanquetEvents.InvoiceIssued)
  async onInvoiceIssued(e: EventEnvelope<BanquetInvoiceIssuedPayload>): Promise<void> {
    const p = e.payload;
    const issuedAt = new Date(p.occurredAt);
    await this.banquets.insertDocument({
      id: p.invoiceId,
      kind: 'invoice',
      number: p.number,
      requestId: p.requestId,
      branchId: p.branchId,
      payerType: p.payerType,
      company: p.company,
      amount: Money.fromJson(p.amount),
      vatAmount: Money.zero(p.amount.currency),
      dueDate: p.dueDate ? p.dueDate.slice(0, 10) : null,
      issuedAt,
      issuedDate: localDateOf(issuedAt),
    });
    // Возвраты по этому счёту могли прийти раньше (выручка банкета уже признана).
    await this.recognizeRefundsOf(null, [p.invoiceId]);
  }

  @OnEvent(BanquetEvents.InvoicePaymentRecorded)
  async onInvoicePayment(e: EventEnvelope<BanquetInvoicePaymentPayload>): Promise<void> {
    const p = e.payload;
    await this.banquets.applyInvoicePayment(p.invoiceId, Money.fromJson(p.paidTotal), p.fullyPaid);
  }

  @OnEvent(BanquetEvents.ActIssued)
  async onActIssued(e: EventEnvelope<BanquetActIssuedPayload>): Promise<void> {
    const p = e.payload;
    const issuedAt = new Date(p.occurredAt);
    await this.banquets.insertDocument({
      id: p.actId,
      kind: 'act',
      number: p.number,
      requestId: p.requestId,
      branchId: p.branchId,
      payerType: p.company ? 'company' : 'individual',
      company: p.company,
      amount: Money.fromJson(p.amount),
      vatAmount: Money.fromJson(p.vatAmount),
      dueDate: null,
      issuedAt,
      issuedDate: localDateOf(issuedAt),
    });
  }

  private async recognizeRefundsOf(requestId: string | null, invoiceIds: string[]): Promise<void> {
    const references = requestId ? [...invoiceIds, requestId] : invoiceIds;
    for (const refund of await this.payments.refundsFor('banquet_invoice', references)) {
      await this.recognizeRefund.execute(refund.refundId);
    }
  }
}
