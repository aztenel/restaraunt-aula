import { Injectable } from '@nestjs/common';
import { Actor } from '../../../../shared/kernel/actor';
import { Money } from '../../../../shared/kernel/money';
import { datesOf, ReportPeriod } from '../../domain/period';
import { CertificateFactsRepository } from '../../infrastructure/certificate-facts.repository';
import { PaymentFactsRepository } from '../../infrastructure/payment-facts.repository';
import { ReportScope, ReportScopes } from '../report-scope';
import { header, PeriodQuery, ReportHeader } from './sales.queries';

// ---------------------------------------------------------------- Движение денег

export interface CashFlowAmounts {
  received: Money;
  refunded: Money;
  net: Money;
}

export interface CashFlowReportView extends ReportHeader {
  methods: Array<{ method: string; provider: string; receivedCount: number; refundedCount: number } & CashFlowAmounts>;
  purposes: Array<{ purpose: string } & CashFlowAmounts>;
  days: Array<{ date: string } & CashFlowAmounts>;
  totals: CashFlowAmounts & {
    /** Оплаты подарочными сертификатами (не деньги: погашение ранее проданного сертификата). */
    certificateRedemptions: Money;
    /** Поступления деньгами (без оплат сертификатами). */
    moneyReceived: Money;
  };
}

function amounts(received: Money, refunded: Money): CashFlowAmounts {
  return { received, refunded, net: received.subtract(refunded) };
}

/**
 * Поступления (отдельно от выручки): успешные платежи и возвраты по способу оплаты и провайдеру,
 * по назначению платежа и по дням.
 */
@Injectable()
export class CashFlowReport {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly payments: PaymentFactsRepository,
  ) {}

  async execute(actor: Actor, query: PeriodQuery): Promise<CashFlowReportView> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    return this.build(this.scopes.period(query), scope);
  }

  async build(period: ReportPeriod, scope: ReportScope): Promise<CashFlowReportView> {
    const methods = await this.payments.byMethod(period, scope.branchIds);
    const purposes = await this.payments.byPurpose(period, scope.branchIds);
    const byDay = new Map((await this.payments.byDay(period, scope.branchIds)).map((r) => [r.date, r]));
    const received = Money.sum(methods.map((m) => m.received));
    const refunded = Money.sum(methods.map((m) => m.refunded));
    const certificateRedemptions = Money.sum(methods.filter((m) => m.method === 'gift_certificate').map((m) => m.received));
    return {
      ...header(period, scope),
      methods: methods.map((m) => ({
        method: m.method,
        provider: m.provider,
        receivedCount: m.receivedCount,
        refundedCount: m.refundedCount,
        ...amounts(m.received, m.refunded),
      })),
      purposes: purposes.map((p) => ({ purpose: p.purpose, ...amounts(p.received, p.refunded) })),
      days: datesOf(period).map((date) => {
        const day = byDay.get(date);
        return { date, ...amounts(day?.received ?? Money.zero(), day?.refunded ?? Money.zero()) };
      }),
      totals: { ...amounts(received, refunded), certificateRedemptions, moneyReceived: received.subtract(certificateRedemptions) },
    };
  }
}

// ---------------------------------------------------------------- Сертификаты

export interface CertificatesReportView extends ReportHeader {
  issued: { count: number; nominal: Money; price: Money };
  issuedByKind: Array<{ kind: string; count: number; nominal: Money; price: Money }>;
  redeemed: { count: number; amount: Money };
  redeemedByChannel: Array<{ channel: string; count: number; amount: Money }>;
  /** Истёкшие и сгоревший остаток (только сводный отчёт: обязательства по сети). */
  expired: { count: number; balance: Money } | null;
  /** Остаток обязательств на конец периода (только сводный отчёт). */
  outstanding: { count: number; balance: Money; asOf: string } | null;
}

/** Сертификаты: выпущено, погашено, просрочено, остаток обязательств. */
@Injectable()
export class CertificatesReport {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly certificates: CertificateFactsRepository,
  ) {}

  async execute(actor: Actor, query: PeriodQuery): Promise<CertificatesReportView> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    return this.build(this.scopes.period(query), scope);
  }

  async build(period: ReportPeriod, scope: ReportScope): Promise<CertificatesReportView> {
    const issuedByKind = await this.certificates.issuedByKind(period, scope.branchIds);
    const redeemedByChannel = await this.certificates.redeemedByChannel(period, scope.branchIds);
    const consolidated = scope.branchIds === null;
    return {
      ...header(period, scope),
      issued: {
        count: issuedByKind.reduce((a, r) => a + r.count, 0),
        nominal: Money.sum(issuedByKind.map((r) => r.nominal)),
        price: Money.sum(issuedByKind.map((r) => r.price)),
      },
      issuedByKind,
      redeemed: { count: redeemedByChannel.reduce((a, r) => a + r.count, 0), amount: Money.sum(redeemedByChannel.map((r) => r.amount)) },
      redeemedByChannel,
      expired: consolidated ? await this.certificates.expired(period) : null,
      outstanding: consolidated ? { ...(await this.certificates.outstanding(period.to)), asOf: period.to } : null,
    };
  }
}
