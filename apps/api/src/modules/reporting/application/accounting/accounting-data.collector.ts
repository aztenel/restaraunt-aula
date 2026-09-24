import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../../../shared/kernel/clock';
import { translate } from '../../../../shared/kernel/translatable';
import { BranchDirectory, LegalEntityDirectory } from '../../../identity/public';
import {
  AccountingBranch,
  AccountingExportData,
  AccountingExportState,
  AccountingOrganization,
  AccountingPaymentMethod,
  ActDocument,
  buildRetailSales,
  counterpartiesOf,
  InvoiceDocument,
} from '../../domain/accounting-export';
import { BanquetFactsRepository } from '../../infrastructure/banquet-facts.repository';
import { OrderFactsRepository } from '../../infrastructure/order-facts.repository';
import { PaymentFactsRepository } from '../../infrastructure/payment-facts.repository';
import { SalesFactsRepository } from '../../infrastructure/sales-facts.repository';

const CHUNK = 1000;

function chunks<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) result.push(items.slice(i, i + CHUNK));
  return result;
}

/**
 * Данные выгрузки в учёт из собственных проекций: розничные продажи по дням и филиалам
 * (выполненные заказы, оплаты по способам, возвраты), продажи сертификатов, счета и акты по банкетам.
 */
@Injectable()
export class AccountingDataCollector {
  private readonly logger = new Logger(AccountingDataCollector.name);

  constructor(
    private readonly orders: OrderFactsRepository,
    private readonly payments: PaymentFactsRepository,
    private readonly sales: SalesFactsRepository,
    private readonly banquets: BanquetFactsRepository,
    private readonly branches: BranchDirectory,
    private readonly legalEntities: LegalEntityDirectory,
    private readonly clock: Clock,
  ) {}

  async collect(state: AccountingExportState): Promise<AccountingExportData> {
    const period = { from: state.periodFrom, to: state.periodTo };
    const branchIds = state.branchId ? [state.branchId] : null;
    const branchMap = new Map<string, AccountingBranch>(
      (await this.branches.list()).map((b) => [b.id, { branchId: b.id, code: b.code, name: translate(b.name, 'ru') }]),
    );
    const branchOf = (id: string | null) => (id ? (branchMap.get(id) ?? { branchId: id, code: '', name: id }) : null);

    const orders = await this.orders.completedForExport(period, branchIds);
    const items = [];
    const payments = [];
    for (const ids of chunks(orders.map((o) => o.orderId))) {
      items.push(...(await this.orders.itemsOf(ids)));
      payments.push(...(await this.payments.orderPayments(ids)));
    }
    const retailSales = buildRetailSales({
      orders,
      items,
      payments: payments.map((p) => ({ ...p, method: p.method as AccountingPaymentMethod })),
      refunds: await this.sales.orderRefundsByDay(period, branchIds),
      branches: branchMap,
    });

    const certificateSales = (await this.sales.certificateSalesByDay(period, branchIds)).map((c) => ({
      date: c.date,
      branch: branchOf(c.branchId),
      count: c.count,
      amount: c.amount,
    }));

    const documents = await this.banquets.documentsForExport(period, branchIds);
    const counterparty = (d: { companyName: string | null; companyBin: string | null }) =>
      d.companyName && d.companyBin ? { name: d.companyName, bin: d.companyBin } : null;
    const invoices: InvoiceDocument[] = documents
      .filter((d) => d.kind === 'invoice')
      .map((d) => ({
        id: d.id,
        number: d.number,
        date: d.issuedDate,
        requestId: d.requestId,
        branch: branchOf(d.branchId),
        payerType: d.payerType ?? (d.companyBin ? 'company' : 'individual'),
        counterparty: counterparty(d),
        amount: d.amount,
        paidTotal: d.paidTotal,
        dueDate: d.dueDate,
      }));
    const acts: ActDocument[] = documents
      .filter((d) => d.kind === 'act')
      .map((d) => ({
        id: d.id,
        number: d.number,
        date: d.issuedDate,
        requestId: d.requestId,
        branch: branchOf(d.branchId),
        counterparty: counterparty(d),
        amount: d.amount,
        vatAmount: d.vatAmount,
      }));

    return {
      exportId: state.id,
      periodFrom: state.periodFrom,
      periodTo: state.periodTo,
      generatedAt: this.clock.now(),
      organization: await this.organization(state.branchId),
      retailSales,
      certificateSales,
      invoices,
      acts,
      counterparties: counterpartiesOf(invoices, acts),
    };
  }

  private async organization(branchId: string | null): Promise<AccountingOrganization | null> {
    try {
      const entity = await this.legalEntities.forBranch(branchId);
      return { name: entity.name, bin: entity.bin };
    } catch (err) {
      this.logger.warn({ err, branchId }, 'Legal entity for accounting export not found');
      return null;
    }
  }
}
