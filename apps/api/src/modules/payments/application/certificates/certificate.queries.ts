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
  CertificateBranchTotals,
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
  /** Можно повторить оплату (онлайн-заказ не выпущен, прошлая попытка отклонена или отменена). */
  canPay: boolean;
}

export interface CertificateReport {
  from: string;
  to: string;
  /** Филиал отчёта; null — вся сеть. */
  branchId: string | null;
  totals: CertificateReportTotals;
  /** Остаток обязательств включён (только сетевой отчёт). */
  liabilityIncluded: boolean;
  byBranch: CertificateBranchTotals[];
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
    const payment = order.paymentId ? await this.paymentQueries.get(order.paymentId) : null;
    return {
      order,
      payment,
      certificates: order.status === 'issued' ? await this.certificates.listByOrder(order.id) : [],
      canPay: order.source === 'online' && order.status !== 'issued' && (payment === null || payment.status === 'failed' || payment.status === 'cancelled'),
    };
  }

  /**
   * Поиск: последние 4 символа кода, телефон покупателя/получателя, статус. Сертификаты действуют
   * во всей сети, поэтому доступны сотруднику с правом certificates.view в любом филиале.
   */
  async search(
    actor: Actor,
    filter: { q?: string; phone?: string; status?: CertificateStatus; orderId?: string; buyer?: string; issuedFrom?: string; issuedTo?: string },
    page: PageRequest,
  ): Promise<Page<CertificateRecord>> {
    actor.assertCanSomewhere(Permission.CertificatesView);
    for (const date of [filter.issuedFrom, filter.issuedTo]) {
      if (date && !isIsoDate(date)) throw new ValidationError('certificate.search_period_invalid', 'Dates must be YYYY-MM-DD');
    }
    const search: CertificateSearchFilter = {
      status: filter.status,
      orderId: filter.orderId,
      buyer: filter.buyer?.trim() || undefined,
      issuedFrom: filter.issuedFrom ? startOfLocalDay(filter.issuedFrom) : undefined,
      issuedTo: filter.issuedTo ? startOfLocalDay(addDays(filter.issuedTo, 1)) : undefined,
    };
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
  async report(actor: Actor, from: string, to: string, branchId?: string | null): Promise<CertificateReport> {
    if (branchId) {
      // Отчёт филиала: где продан/погашен сертификат — certificates.view или reports.branch в филиале.
      if (!actor.can(Permission.CertificatesView, branchId) && !actor.can(Permission.ReportsBranch, branchId)) {
        throw new ForbiddenError('access.forbidden_branch', 'Permission certificates.view or reports.branch in this branch required', { branchId });
      }
    } else if (!actor.can(Permission.CertificatesView) && !actor.can(Permission.ReportsConsolidated)) {
      throw new ForbiddenError('access.forbidden', 'Permission certificates.view (all branches) or reports.consolidated required');
    }
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
      throw new ValidationError('report.invalid_period', 'Period must be YYYY-MM-DD, from <= to');
    }
    const range = { from: startOfLocalDay(from), to: startOfLocalDay(addDays(to, 1)) };
    if (branchId) {
      return {
        from,
        to,
        branchId,
        totals: await this.certificates.branchReport(branchId, range.from, range.to),
        liabilityIncluded: false,
        byBranch: await this.certificates.totalsByBranch(range.from, range.to, [branchId]),
      };
    }
    return {
      from,
      to,
      branchId: null,
      totals: await this.certificates.report(range.from, range.to),
      liabilityIncluded: true,
      byBranch: await this.certificates.totalsByBranch(range.from, range.to, 'all'),
    };
  }
}
