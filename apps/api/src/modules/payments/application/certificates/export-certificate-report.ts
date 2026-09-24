import { Injectable } from '@nestjs/common';
import { XlsxBuilder } from '../../../../shared/infrastructure/xlsx/xlsx-builder';
import { Actor } from '../../../../shared/kernel/actor';
import { CertificateQueries } from './certificate.queries';

interface ReportRow {
  metric: string;
  count: number | null;
  amount: number;
}

/** Выгрузка отчёта по сертификатам в XLSX (суммы в тенге, формат ячейки). */
@Injectable()
export class ExportCertificateReport {
  constructor(
    private readonly queries: CertificateQueries,
    private readonly xlsx: XlsxBuilder,
  ) {}

  async execute(actor: Actor, from: string, to: string): Promise<Buffer> {
    const { totals: t } = await this.queries.report(actor, from, to);
    const rows: ReportRow[] = [
      { metric: 'Выпущено (номинал)', count: t.issued.count, amount: t.issued.nominal },
      { metric: 'Выпущено (выручка от продажи)', count: t.issued.count, amount: t.issued.price },
      { metric: 'Погашено (списания)', count: t.redeemed.operations, amount: t.redeemed.amount },
      { metric: 'Возвращено на сертификаты', count: t.returned.operations, amount: t.returned.amount },
      { metric: 'Просрочено (сгоревший остаток)', count: t.expired.count, amount: t.expired.amount },
      { metric: 'Восстановлено продлением', count: t.reinstated.count, amount: t.reinstated.amount },
      { metric: 'Остаток обязательств: активные', count: t.liability.active.count, amount: t.liability.active.amount },
      { metric: 'Остаток обязательств: заблокированные', count: t.liability.blocked.count, amount: t.liability.blocked.amount },
    ];
    return this.xlsx.build([
      {
        name: `Сертификаты ${from} — ${to}`,
        columns: [
          { header: 'Показатель', key: 'metric', width: 42 },
          { header: 'Количество', key: 'count', format: 'number' },
          { header: 'Сумма, ₸', key: 'amount', format: 'money' },
        ],
        rows,
      },
    ]);
  }
}
