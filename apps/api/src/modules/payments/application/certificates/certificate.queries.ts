import { Injectable } from '@nestjs/common';
import { Actor } from '../../../../shared/kernel/actor';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../shared/kernel/errors';
import { Page, PageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { tryNormalizePhone } from '../../../../shared/kernel/phone';
import { addDays, isIsoDate, startOfLocalDay } from '../../../../shared/kernel/time';
import { CertificateOrder, CertificateOrderRepository } from '../../infrastructure/certificate-order.repository';
import { CertificateProduct, CertificateProductRepository } from '../../infrastructure/certificate-product.repository';
import {
  CertificateRecord,
  CertificateReportTotals,
  CertificateRepository,
  CertificateSearchFilter,
  LedgerEntry,
} from '../../infrastructure/certificate.repository';
import { CertificateStatus, PaymentView } from '../../public';
import { PaymentQueries } from '../payment.queries';

export interface CertificateDetails {
  record: CertificateRecord;
  ledger: LedgerEntry[];
  order: CertificateOrder | null;
}

export interface CertificateOrderStatusView {
  order: CertificateOrder;
  payment: PaymentView | null;
  certificates: CertificateRecord[];
}

export interface CertificateReport {
  from: string;
  to: string;
  totals: CertificateReportTotals;
}

/** Чтение сертификатов: витрина (продукты, статус заказа) и админка (поиск, карточка, отчёт). */
@Injectable()
export class CertificateQueries {
  constructor(
    private readonly products: CertificateProductRepository,
    private readonly orders: CertificateOrderRepository,
    private readonly certificates: CertificateRepository,
    private readonly paymentQueries: PaymentQueries,
  ) {}

  activeProducts(): Promise<CertificateProduct[]> {
    return this.products.list({ activeOnly: true });
  }

  async adminProducts(actor: Actor): Promise<CertificateProduct[]> {
    if (!actor.canSomewhere(Permission.CertificatesView) && !actor.can(Permission.CertificatesManage)) {
      throw new ForbiddenError('access.forbidden', 'Permission certificates.view required');
    }
    return this.products.list({ activeOnly: false });
  }

  async orderStatus(token: string): Promise<CertificateOrderStatusView> {
    const order = await this.orders.findByToken(token);
    if (!order) throw new NotFoundError('certificate_order');
    return {
      order,
      payment: order.paymentId ? await this.paymentQueries.get(order.paymentId) : null,
      certificates: order.status === 'issued' ? await this.certificates.listByOrder(order.id) : [],
    };
  }

  /**
   * Поиск: последние 4 символа кода, телефон покупателя/получателя, статус. Сертификаты действуют
   * во всей сети, поэтому доступны сотруднику с правом certificates.view в любом филиале.
   */
  async search(actor: Actor, filter: { q?: string; phone?: string; status?: CertificateStatus; orderId?: string }, page: PageRequest): Promise<Page<CertificateRecord>> {
    actor.assertCanSomewhere(Permission.CertificatesView);
    const search: CertificateSearchFilter = { status: filter.status, orderId: filter.orderId };
    if (filter.q) {
      const last4 = filter.q.replace(/[\s-]/g, '').toUpperCase().slice(-4);
      if (last4.length !== 4) throw new ValidationError('certificate.search_last4', 'Enter the last 4 characters of the code');
      search.last4 = last4;
    }
    if (filter.phone) {
      const phone = tryNormalizePhone(filter.phone);
      if (!phone) throw new ValidationError('phone.invalid', 'Invalid phone');
      search.buyerPhone = phone;
    }
    return this.certificates.search(search, page);
  }

  async details(actor: Actor, id: string): Promise<CertificateDetails> {
    actor.assertCanSomewhere(Permission.CertificatesView);
    const record = await this.certificates.findById(id);
    if (!record) throw new NotFoundError('certificate', id);
    return {
      record,
      ledger: await this.certificates.ledger(id),
      order: await this.orders.findById(record.certificate.snapshot().orderId),
    };
  }

  /**
   * Отчёт за период (даты в Asia/Almaty, включительно): выпущено, погашено, возвращено на сертификаты,
   * просрочено; остаток обязательств — на текущий момент. Сводные данные сети: глобальное право
   * certificates.view или reports.consolidated.
   */
  async report(actor: Actor, from: string, to: string): Promise<CertificateReport> {
    if (!actor.can(Permission.CertificatesView) && !actor.can(Permission.ReportsConsolidated)) {
      throw new ForbiddenError('access.forbidden', 'Permission certificates.view (all branches) or reports.consolidated required');
    }
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
      throw new ValidationError('report.invalid_period', 'Period must be YYYY-MM-DD, from <= to');
    }
    const totals = await this.certificates.report(startOfLocalDay(from), startOfLocalDay(addDays(to, 1)));
    return { from, to, totals };
  }
}
