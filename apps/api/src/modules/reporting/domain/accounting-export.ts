import { ConflictError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { StateMachine } from '../../../shared/kernel/state-machine';
import { Translatable } from '../../../shared/kernel/translatable';

/**
 * Выгрузка продаж и документов в учёт (1С, этап 3). Формат — адаптер за интерфейсом
 * AccountingExporter: XML, близкий к EnterpriseData, или XLSX. Файл строится задачей в очереди,
 * хранится приватно; при настроенном HTTP-сервисе 1С отправляется туда задачей с повторами.
 */
export const AccountingExportFormat = { OnecXml: 'onec_xml', Xlsx: 'xlsx' } as const;
export type AccountingExportFormat = (typeof AccountingExportFormat)[keyof typeof AccountingExportFormat];
export const ACCOUNTING_EXPORT_FORMATS = Object.values(AccountingExportFormat);

export const AccountingExportStatus = { Pending: 'pending', Ready: 'ready', Failed: 'failed' } as const;
export type AccountingExportStatus = (typeof AccountingExportStatus)[keyof typeof AccountingExportStatus];

export const AccountingPushStatus = {
  /** Отправка в 1С не требуется (формат XLSX, интеграция выключена или отправка не запрошена). */
  NotRequired: 'not_required',
  Pending: 'pending',
  Pushed: 'pushed',
  Failed: 'failed',
} as const;
export type AccountingPushStatus = (typeof AccountingPushStatus)[keyof typeof AccountingPushStatus];

export const ACCOUNTING_EXPORT_MACHINE = new StateMachine<AccountingExportStatus>('accounting_export', {
  pending: ['ready', 'failed'],
  ready: [],
  failed: [],
});

export const ACCOUNTING_PUSH_MACHINE = new StateMachine<AccountingPushStatus>('accounting_export_push', {
  not_required: ['pending'],
  pending: ['pushed', 'failed'],
  // Повторная отправка готового файла (вручную из админки).
  pushed: ['pending'],
  failed: ['pending'],
});

/** Лимиты попыток: построение файла и отправка в HTTP-сервис 1С. */
export const BUILD_MAX_ATTEMPTS = 3;
export const PUSH_MAX_ATTEMPTS = 6;

export interface AccountingExportTotals {
  retailSales: Money;
  refunds: Money;
  certificateSales: Money;
  invoices: Money;
  acts: Money;
  retailDocuments: number;
  invoiceCount: number;
  actCount: number;
}

export interface AccountingExportFile {
  key: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

export interface AccountingExportState {
  id: string;
  format: AccountingExportFormat;
  periodFrom: string;
  periodTo: string;
  branchId: string | null;
  status: AccountingExportStatus;
  buildAttempts: number;
  file: AccountingExportFile | null;
  totals: AccountingExportTotals | null;
  error: string | null;
  pushRequested: boolean;
  pushStatus: AccountingPushStatus;
  pushAttempts: number;
  pushedAt: Date | null;
  pushError: string | null;
  requestedBy: string | null;
  requestedAt: Date;
  completedAt: Date | null;
}

/** Выгрузка: статусы построения и отправки — конечные автоматы. */
export class AccountingExport {
  private constructor(private state: AccountingExportState) {}

  static request(input: {
    id: string;
    format: AccountingExportFormat;
    periodFrom: string;
    periodTo: string;
    branchId: string | null;
    pushRequested: boolean;
    requestedBy: string | null;
    requestedAt: Date;
  }): AccountingExport {
    return new AccountingExport({
      ...input,
      status: AccountingExportStatus.Pending,
      buildAttempts: 0,
      file: null,
      totals: null,
      error: null,
      pushStatus: AccountingPushStatus.NotRequired,
      pushAttempts: 0,
      pushedAt: null,
      pushError: null,
      completedAt: null,
    });
  }

  static restore(state: AccountingExportState): AccountingExport {
    return new AccountingExport({ ...state });
  }

  snapshot(): AccountingExportState {
    return { ...this.state };
  }

  get id(): string {
    return this.state.id;
  }

  get status(): AccountingExportStatus {
    return this.state.status;
  }

  get pushStatus(): AccountingPushStatus {
    return this.state.pushStatus;
  }

  get format(): AccountingExportFormat {
    return this.state.format;
  }

  /** Отправлять ли файл в HTTP-сервис 1С (только XML). */
  canBePushed(): boolean {
    return this.state.format === AccountingExportFormat.OnecXml && this.state.status === AccountingExportStatus.Ready;
  }

  /** Файл готов. pushEnabled — настроен ли HTTP-сервис 1С; тогда отправка ставится в очередь. */
  markReady(file: AccountingExportFile, totals: AccountingExportTotals, now: Date, pushEnabled: boolean): void {
    ACCOUNTING_EXPORT_MACHINE.assertTransition(this.state.status, AccountingExportStatus.Ready);
    this.state = { ...this.state, status: AccountingExportStatus.Ready, file, totals, error: null, completedAt: now };
    if (pushEnabled && this.state.pushRequested && this.canBePushed()) this.requestPush();
  }

  markFailed(error: string, now: Date): void {
    ACCOUNTING_EXPORT_MACHINE.assertTransition(this.state.status, AccountingExportStatus.Failed);
    this.state = { ...this.state, status: AccountingExportStatus.Failed, error: error.slice(0, 2000), completedAt: now };
  }

  /** Поставить отправку в 1С (автоматически после построения или повторно вручную). */
  requestPush(): void {
    if (!this.canBePushed()) {
      throw new ConflictError('accounting_export.push_not_available', 'Only a ready XML export can be sent to the accounting service');
    }
    ACCOUNTING_PUSH_MACHINE.assertTransition(this.state.pushStatus, AccountingPushStatus.Pending);
    this.state = { ...this.state, pushStatus: AccountingPushStatus.Pending, pushAttempts: 0, pushError: null };
  }

  markPushed(now: Date): void {
    ACCOUNTING_PUSH_MACHINE.assertTransition(this.state.pushStatus, AccountingPushStatus.Pushed);
    this.state = { ...this.state, pushStatus: AccountingPushStatus.Pushed, pushedAt: now, pushError: null };
  }

  markPushFailed(error: string): void {
    ACCOUNTING_PUSH_MACHINE.assertTransition(this.state.pushStatus, AccountingPushStatus.Failed);
    this.state = { ...this.state, pushStatus: AccountingPushStatus.Failed, pushError: error.slice(0, 2000) };
  }
}

// ---------------------------------------------------------------- Данные выгрузки (модель документов)

export type AccountingPaymentMethod = 'online' | 'on_receipt' | 'gift_certificate' | 'bank_transfer';

export interface AccountingBranch {
  branchId: string;
  code: string;
  name: string;
}

export interface AccountingOrganization {
  name: string;
  bin: string;
}

export interface RetailSaleLine {
  dishId: string;
  name: Translatable;
  quantity: number;
  amount: Money;
}

/** Отчёт о розничных продажах: день × филиал, позиции, доставка, скидки, оплаты по способам, возвраты. */
export interface RetailSalesDocument {
  date: string;
  branch: AccountingBranch;
  orders: number;
  lines: RetailSaleLine[];
  deliveryFees: Money;
  discounts: Money;
  total: Money;
  payments: Array<{ method: AccountingPaymentMethod; amount: Money }>;
  /** Возвраты по выполненным заказам в этот день (уменьшают выручку дня возврата). */
  refunds: Money;
}

export interface CertificateSalesDocument {
  date: string;
  branch: AccountingBranch | null;
  count: number;
  amount: Money;
}

export interface AccountingCounterparty {
  name: string;
  bin: string;
}

export interface InvoiceDocument {
  id: string;
  number: string;
  date: string;
  requestId: string;
  branch: AccountingBranch | null;
  payerType: 'individual' | 'company';
  counterparty: AccountingCounterparty | null;
  amount: Money;
  paidTotal: Money;
  dueDate: string | null;
}

export interface ActDocument {
  id: string;
  number: string;
  date: string;
  requestId: string;
  branch: AccountingBranch | null;
  counterparty: AccountingCounterparty | null;
  amount: Money;
  vatAmount: Money;
}

export interface AccountingExportData {
  exportId: string;
  periodFrom: string;
  periodTo: string;
  generatedAt: Date;
  organization: AccountingOrganization | null;
  retailSales: RetailSalesDocument[];
  certificateSales: CertificateSalesDocument[];
  invoices: InvoiceDocument[];
  acts: ActDocument[];
  counterparties: AccountingCounterparty[];
}

// ---------------------------------------------------------------- Сборка розничных продаж

export interface CompletedOrderForExport {
  orderId: string;
  branchId: string;
  completedDate: string;
  paymentMethod: 'online' | 'on_receipt' | null;
  subtotal: Money;
  discount: Money;
  deliveryFee: Money;
  total: Money;
}

export interface OrderItemForExport {
  orderId: string;
  dishId: string;
  name: Translatable;
  quantity: number;
  lineTotal: Money;
}

export interface OrderPaymentForExport {
  orderId: string;
  method: AccountingPaymentMethod;
  amount: Money;
}

export interface OrderRefundForExport {
  branchId: string;
  date: string;
  amount: Money;
}

const METHOD_ORDER: readonly AccountingPaymentMethod[] = ['online', 'on_receipt', 'gift_certificate', 'bank_transfer'];

/**
 * Отчёты о розничных продажах по дням и филиалам. Оплаты по способам — из фактических платежей
 * заказа; не покрытый платежами остаток относится к способу оплаты заказа (оплата при получении
 * подтверждается при выдаче).
 */
export function buildRetailSales(input: {
  orders: readonly CompletedOrderForExport[];
  items: readonly OrderItemForExport[];
  payments: readonly OrderPaymentForExport[];
  refunds: readonly OrderRefundForExport[];
  branches: ReadonlyMap<string, AccountingBranch>;
}): RetailSalesDocument[] {
  const docs = new Map<string, RetailSalesDocument & { lineMap: Map<string, RetailSaleLine>; paymentMap: Map<string, Money> }>();
  const branchOf = (branchId: string): AccountingBranch => input.branches.get(branchId) ?? { branchId, code: '', name: branchId };
  const doc = (date: string, branchId: string) => {
    const key = `${date}|${branchId}`;
    let d = docs.get(key);
    if (!d) {
      d = {
        date,
        branch: branchOf(branchId),
        orders: 0,
        lines: [],
        deliveryFees: Money.zero(),
        discounts: Money.zero(),
        total: Money.zero(),
        payments: [],
        refunds: Money.zero(),
        lineMap: new Map(),
        paymentMap: new Map(),
      };
      docs.set(key, d);
    }
    return d;
  };

  const itemsByOrder = new Map<string, OrderItemForExport[]>();
  for (const item of input.items) itemsByOrder.set(item.orderId, [...(itemsByOrder.get(item.orderId) ?? []), item]);
  const paymentsByOrder = new Map<string, OrderPaymentForExport[]>();
  for (const p of input.payments) paymentsByOrder.set(p.orderId, [...(paymentsByOrder.get(p.orderId) ?? []), p]);

  for (const order of input.orders) {
    const d = doc(order.completedDate, order.branchId);
    d.orders += 1;
    d.total = d.total.add(order.total);
    d.discounts = d.discounts.add(order.discount);
    d.deliveryFees = d.deliveryFees.add(order.deliveryFee);
    for (const item of itemsByOrder.get(order.orderId) ?? []) {
      const line = d.lineMap.get(item.dishId) ?? { dishId: item.dishId, name: item.name, quantity: 0, amount: Money.zero() };
      line.quantity += item.quantity;
      line.amount = line.amount.add(item.lineTotal);
      d.lineMap.set(item.dishId, line);
    }
    let paid = Money.zero();
    for (const p of paymentsByOrder.get(order.orderId) ?? []) {
      const allowed = order.total.subtract(paid).clampToZero().min(p.amount);
      if (allowed.isZero()) continue;
      paid = paid.add(allowed);
      d.paymentMap.set(p.method, (d.paymentMap.get(p.method) ?? Money.zero()).add(allowed));
    }
    const rest = order.total.subtract(paid);
    if (rest.isPositive()) {
      const method: AccountingPaymentMethod = order.paymentMethod ?? 'on_receipt';
      d.paymentMap.set(method, (d.paymentMap.get(method) ?? Money.zero()).add(rest));
    }
  }
  for (const refund of input.refunds) {
    const d = doc(refund.date, refund.branchId);
    d.refunds = d.refunds.add(refund.amount);
  }

  return [...docs.values()]
    .map(({ lineMap, paymentMap, ...d }) => ({
      ...d,
      lines: [...lineMap.values()].sort((a, b) => b.amount.amount - a.amount.amount || a.dishId.localeCompare(b.dishId)),
      payments: METHOD_ORDER.filter((m) => paymentMap.has(m)).map((method) => ({ method, amount: paymentMap.get(method)! })),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.branch.code.localeCompare(b.branch.code) || a.branch.branchId.localeCompare(b.branch.branchId));
}

/** Уникальные контрагенты-юрлица из счетов и актов (по БИН). */
export function counterpartiesOf(invoices: readonly InvoiceDocument[], acts: readonly ActDocument[]): AccountingCounterparty[] {
  const byBin = new Map<string, AccountingCounterparty>();
  for (const doc of [...invoices, ...acts]) {
    if (doc.counterparty && !byBin.has(doc.counterparty.bin)) byBin.set(doc.counterparty.bin, doc.counterparty);
  }
  return [...byBin.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function accountingTotals(data: Pick<AccountingExportData, 'retailSales' | 'certificateSales' | 'invoices' | 'acts'>): AccountingExportTotals {
  return {
    retailSales: Money.sum(data.retailSales.map((d) => d.total)),
    refunds: Money.sum(data.retailSales.map((d) => d.refunds)),
    certificateSales: Money.sum(data.certificateSales.map((d) => d.amount)),
    invoices: Money.sum(data.invoices.map((d) => d.amount)),
    acts: Money.sum(data.acts.map((d) => d.amount)),
    retailDocuments: data.retailSales.length,
    invoiceCount: data.invoices.length,
    actCount: data.acts.length,
  };
}

export function exportFileName(format: AccountingExportFormat, from: string, to: string, branchCode: string | null): string {
  const scope = branchCode ? `_${branchCode}` : '';
  return `aula_accounting${scope}_${from}_${to}.${format === AccountingExportFormat.Xlsx ? 'xlsx' : 'xml'}`;
}
