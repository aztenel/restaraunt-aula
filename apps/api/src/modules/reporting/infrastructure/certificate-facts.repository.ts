import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Money } from '../../../shared/kernel/money';
import { ReportPeriod } from '../domain/period';
import { ReportingTables } from './reporting.tables';
import { branchFilter, inPeriod } from './sql-helpers';

const T = 'reporting.certificates';

/** Проекция подарочных сертификатов: выпуск, погашения, истечение (события Payments). */
@Injectable()
export class CertificateFactsRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReportingTables>();
  }

  async applyIssued(c: {
    certificateId: string;
    productId: string;
    kind: string;
    nominal: Money;
    price: Money;
    branchId: string | null;
    issuedAt: Date;
    issuedDate: string;
  }): Promise<void> {
    await this.db()
      .insertInto(T)
      .values({
        certificate_id: c.certificateId,
        product_id: c.productId,
        kind: c.kind,
        nominal_amount: c.nominal.amount,
        nominal_currency: c.nominal.currency,
        price_amount: c.price.amount,
        price_currency: c.price.currency,
        branch_id: c.branchId,
        issued_at: c.issuedAt,
        issued_date: c.issuedDate,
      })
      .onConflict((oc) =>
        oc.column('certificate_id').doUpdateSet({
          product_id: sql<string>`excluded.product_id`,
          kind: sql<string>`excluded.kind`,
          nominal_amount: sql<number>`excluded.nominal_amount`,
          price_amount: sql<number>`excluded.price_amount`,
          branch_id: sql<string>`excluded.branch_id`,
          issued_at: sql<Date>`excluded.issued_at`,
          issued_date: sql<string>`excluded.issued_date`,
        }),
      )
      .execute();
  }

  async applyExpired(c: {
    certificateId: string;
    kind: string;
    nominal: Money;
    balance: Money;
    expiresAt: Date;
    expiredAt: Date;
    expiredDate: string;
  }): Promise<void> {
    await this.db()
      .insertInto(T)
      .values({
        certificate_id: c.certificateId,
        kind: c.kind,
        nominal_amount: c.nominal.amount,
        nominal_currency: c.nominal.currency,
        expires_at: c.expiresAt,
        expired_at: c.expiredAt,
        expired_date: c.expiredDate,
        expired_balance_amount: c.balance.amount,
        expired_balance_currency: c.balance.currency,
      })
      .onConflict((oc) =>
        oc.column('certificate_id').doUpdateSet({
          expires_at: sql<Date>`excluded.expires_at`,
          expired_at: sql<Date>`excluded.expired_at`,
          expired_date: sql<string>`excluded.expired_date`,
          expired_balance_amount: sql<number>`excluded.expired_balance_amount`,
        }),
      )
      .execute();
  }

  async insertRedemption(r: {
    eventId: string;
    certificateId: string;
    amount: Money;
    balanceAfter: Money;
    branchId: string | null;
    channel: string;
    referenceId: string | null;
    redeemedAt: Date;
    redeemedDate: string;
  }): Promise<void> {
    await this.db()
      .insertInto('reporting.certificate_redemptions')
      .values({
        event_id: r.eventId,
        certificate_id: r.certificateId,
        redeemed_amount: r.amount.amount,
        redeemed_currency: r.amount.currency,
        balance_after_amount: r.balanceAfter.amount,
        balance_after_currency: r.balanceAfter.currency,
        branch_id: r.branchId,
        channel: r.channel,
        reference_id: r.referenceId,
        redeemed_at: r.redeemedAt,
        redeemed_date: r.redeemedDate,
      })
      .onConflict((oc) => oc.column('event_id').doNothing())
      .execute();
  }

  /**
   * Истёкший сертификат продлён (событие CertificateReinstated): остаток больше не «сгоревший» —
   * отметка истечения снимается, остаток возвращается в обязательства. Повторное истечение ставит её снова.
   */
  async applyReinstated(c: { certificateId: string; expiresAt: Date }): Promise<void> {
    await this.db()
      .updateTable(T)
      .set({ expires_at: c.expiresAt, expired_at: null, expired_date: null, expired_balance_amount: null })
      .where('certificate_id', '=', c.certificateId)
      .execute();
  }

  /** Возврат суммы на сертификат (отмена заказа, оплаченного сертификатом). Идемпотентно по событию. */
  async insertCredit(c: {
    eventId: string;
    certificateId: string;
    amount: Money;
    balanceAfter: Money;
    branchId: string | null;
    refundId: string | null;
    paymentId: string | null;
    creditedAt: Date;
    creditedDate: string;
  }): Promise<void> {
    await this.db()
      .insertInto('reporting.certificate_credits')
      .values({
        event_id: c.eventId,
        certificate_id: c.certificateId,
        credited_amount: c.amount.amount,
        credited_currency: c.amount.currency,
        balance_after_amount: c.balanceAfter.amount,
        balance_after_currency: c.balanceAfter.currency,
        branch_id: c.branchId,
        refund_id: c.refundId,
        payment_id: c.paymentId,
        credited_at: c.creditedAt,
        credited_date: c.creditedDate,
      })
      .onConflict((oc) => oc.column('event_id').doNothing())
      .execute();
  }

  // ---------------------------------------------------------------- отчёты

  async issuedByKind(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ kind: string; count: number; nominal: number; price: number }>`
      select kind, count(*) as count, coalesce(sum(nominal_amount), 0)::bigint as nominal, coalesce(sum(price_amount), 0)::bigint as price
      from reporting.certificates
      where issued_date is not null and ${inPeriod('issued_date', period)} and ${branchFilter('branch_id', branchIds)}
      group by kind
      order by kind
    `.execute(this.db());
    return result.rows.map((r) => ({
      kind: r.kind,
      count: Number(r.count),
      nominal: Money.of(Number(r.nominal)),
      price: Money.of(Number(r.price)),
    }));
  }

  async redeemedByChannel(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ channel: string; count: number; amount: number }>`
      select channel, count(*) as count, coalesce(sum(redeemed_amount), 0)::bigint as amount
      from reporting.certificate_redemptions
      where ${inPeriod('redeemed_date', period)} and ${branchFilter('branch_id', branchIds)}
      group by channel
      order by channel
    `.execute(this.db());
    return result.rows.map((r) => ({ channel: r.channel, count: Number(r.count), amount: Money.of(Number(r.amount)) }));
  }

  /** Возвращено на сертификаты в периоде (отмены заказов, оплаченных сертификатом). */
  async credited(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ count: number; amount: number }>`
      select count(*) as count, coalesce(sum(credited_amount), 0)::bigint as amount
      from reporting.certificate_credits
      where ${inPeriod('credited_date', period)} and ${branchFilter('branch_id', branchIds)}
    `.execute(this.db());
    return { count: Number(result.rows[0]?.count ?? 0), amount: Money.of(Number(result.rows[0]?.amount ?? 0)) };
  }

  /** Истёкшие в периоде: количество и сгоревший остаток (обязательства по сети). */
  async expired(period: ReportPeriod) {
    const result = await sql<{ count: number; balance: number }>`
      select count(*) as count, coalesce(sum(expired_balance_amount), 0)::bigint as balance
      from reporting.certificates
      where expired_date is not null and ${inPeriod('expired_date', period)}
    `.execute(this.db());
    return { count: Number(result.rows[0]?.count ?? 0), balance: Money.of(Number(result.rows[0]?.balance ?? 0)) };
  }

  /**
   * Остаток обязательств на конец дня asOf: номинал выпущенных − погашения + возвраты на сертификат −
   * сгоревшие остатки. Количество — сертификаты с ненулевым остатком, не истёкшие к этой дате.
   */
  async outstanding(asOf: string) {
    const result = await sql<{ count: number; balance: number }>`
      with c as (
        select c.certificate_id, c.nominal_amount,
               coalesce((select sum(r.redeemed_amount) from reporting.certificate_redemptions r
                         where r.certificate_id = c.certificate_id and r.redeemed_date <= ${asOf}::date), 0)
               - coalesce((select sum(k.credited_amount) from reporting.certificate_credits k
                         where k.certificate_id = c.certificate_id and k.credited_date <= ${asOf}::date), 0) as redeemed,
               case when c.expired_date is not null and c.expired_date <= ${asOf}::date then coalesce(c.expired_balance_amount, 0) else 0 end as burned,
               (c.expired_date is not null and c.expired_date <= ${asOf}::date) as is_expired
        from reporting.certificates c
        where c.issued_date is not null and c.issued_date <= ${asOf}::date
      )
      select count(*) filter (where not is_expired and nominal_amount - redeemed > 0) as count,
             coalesce(sum(greatest(nominal_amount - redeemed - burned, 0)), 0)::bigint as balance
      from c
    `.execute(this.db());
    return { count: Number(result.rows[0]?.count ?? 0), balance: Money.of(Number(result.rows[0]?.balance ?? 0)) };
  }
}
