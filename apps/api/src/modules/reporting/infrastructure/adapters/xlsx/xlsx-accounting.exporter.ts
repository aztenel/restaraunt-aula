import { Injectable } from '@nestjs/common';
import { XlsxBuilder } from '../../../../../shared/infrastructure/xlsx/xlsx-builder';
import { Money } from '../../../../../shared/kernel/money';
import { translate } from '../../../../../shared/kernel/translatable';
import { AccountingExportArtifact, AccountingExporter } from '../../../application/accounting/accounting-exporter';
import { XLSX_CONTENT_TYPE } from '../../../application/reports/report-sheets';
import { AccountingExportData, AccountingExportFormat, AccountingPaymentMethod } from '../../../domain/accounting-export';

const METHODS: AccountingPaymentMethod[] = ['online', 'on_receipt', 'gift_certificate', 'bank_transfer'];

/** Выгрузка в учёт в XLSX (для бухгалтерии без обмена с 1С): те же документы, что и в XML. */
@Injectable()
export class XlsxAccountingExporter extends AccountingExporter {
  readonly format = AccountingExportFormat.Xlsx;

  constructor(private readonly xlsx: XlsxBuilder) {
    super();
  }

  async build(data: AccountingExportData): Promise<AccountingExportArtifact> {
    const method = (payments: Array<{ method: AccountingPaymentMethod; amount: Money }>, m: AccountingPaymentMethod) =>
      payments.find((p) => p.method === m)?.amount ?? Money.zero();
    const body = await this.xlsx.build([
      {
        name: 'Розничные продажи',
        columns: [
          { header: 'Дата', key: 'date', format: 'date' },
          { header: 'Филиал', key: 'branch', width: 24 },
          { header: 'Код', key: 'code', width: 8 },
          { header: 'Чеков', key: 'orders', format: 'number' },
          { header: 'Сумма, ₸', key: 'total', format: 'money' },
          { header: 'Скидки, ₸', key: 'discounts', format: 'money' },
          { header: 'Доставка, ₸', key: 'deliveryFees', format: 'money' },
          { header: 'Возвраты, ₸', key: 'refunds', format: 'money' },
          { header: 'Онлайн, ₸', key: 'online', format: 'money' },
          { header: 'При получении, ₸', key: 'on_receipt', format: 'money' },
          { header: 'Сертификатом, ₸', key: 'gift_certificate', format: 'money' },
          { header: 'Перевод, ₸', key: 'bank_transfer', format: 'money' },
        ],
        rows: data.retailSales.map((d) => ({
          date: d.date,
          branch: d.branch.name,
          code: d.branch.code,
          orders: d.orders,
          total: d.total,
          discounts: d.discounts,
          deliveryFees: d.deliveryFees,
          refunds: d.refunds,
          ...Object.fromEntries(METHODS.map((m) => [m, method(d.payments, m)])),
        })),
      },
      {
        name: 'Позиции',
        columns: [
          { header: 'Дата', key: 'date', format: 'date' },
          { header: 'Филиал', key: 'code', width: 8 },
          { header: 'Блюдо', key: 'dish', width: 40 },
          { header: 'Код блюда', key: 'dishId', width: 38 },
          { header: 'Количество', key: 'quantity', format: 'number' },
          { header: 'Сумма, ₸', key: 'amount', format: 'money' },
        ],
        rows: data.retailSales.flatMap((d) =>
          d.lines.map((l) => ({ date: d.date, code: d.branch.code, dish: translate(l.name, 'ru'), dishId: l.dishId, quantity: l.quantity, amount: l.amount })),
        ),
      },
      {
        name: 'Сертификаты',
        columns: [
          { header: 'Дата', key: 'date', format: 'date' },
          { header: 'Филиал', key: 'branch', width: 24 },
          { header: 'Количество', key: 'count', format: 'number' },
          { header: 'Сумма, ₸', key: 'amount', format: 'money' },
        ],
        rows: data.certificateSales.map((c) => ({ date: c.date, branch: c.branch?.name ?? 'онлайн', count: c.count, amount: c.amount })),
      },
      {
        name: 'Счета',
        columns: [
          { header: 'Номер', key: 'number', width: 18 },
          { header: 'Дата', key: 'date', format: 'date' },
          { header: 'Контрагент', key: 'counterparty', width: 36 },
          { header: 'БИН', key: 'bin', width: 14 },
          { header: 'Сумма, ₸', key: 'amount', format: 'money' },
          { header: 'Оплачено, ₸', key: 'paidTotal', format: 'money' },
          { header: 'Срок оплаты', key: 'dueDate', format: 'date' },
        ],
        rows: data.invoices.map((i) => ({
          ...i,
          counterparty: i.counterparty?.name ?? 'Физическое лицо',
          bin: i.counterparty?.bin ?? '',
        })),
      },
      {
        name: 'Акты',
        columns: [
          { header: 'Номер', key: 'number', width: 18 },
          { header: 'Дата', key: 'date', format: 'date' },
          { header: 'Контрагент', key: 'counterparty', width: 36 },
          { header: 'БИН', key: 'bin', width: 14 },
          { header: 'Сумма, ₸', key: 'amount', format: 'money' },
          { header: 'НДС, ₸', key: 'vatAmount', format: 'money' },
        ],
        rows: data.acts.map((a) => ({ ...a, counterparty: a.counterparty?.name ?? 'Физическое лицо', bin: a.counterparty?.bin ?? '' })),
      },
    ]);
    return { body, contentType: XLSX_CONTENT_TYPE, extension: 'xlsx' };
  }
}
