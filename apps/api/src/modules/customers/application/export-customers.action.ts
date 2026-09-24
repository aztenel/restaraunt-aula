import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { XlsxBuilder } from '../../../shared/infrastructure/xlsx/xlsx-builder';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { toLocalDate, toLocalTime } from '../../../shared/kernel/time';
import { isAnonymizedPhone } from '../domain/customer';
import { CustomerFilter, mergeFilters, normalizeCustomerFilter } from '../domain/customer-filter';
import {
  buildCsv,
  EXPORT_COLUMNS,
  EXPORT_FORMATS,
  EXPORT_PURPOSES,
  exportFileName,
  exportFilter,
  ExportFormat,
  ExportPurpose,
  ExportRow,
  MAX_EXPORT_ROWS,
} from '../domain/export';
import { CustomerRecord, CustomerRepository } from '../infrastructure/customer.repository';
import { SegmentRepository } from '../infrastructure/segment.repository';

export interface ExportCustomersInput {
  format: ExportFormat;
  purpose: ExportPurpose;
  segmentId?: string | null;
  filter?: CustomerFilter | Record<string, unknown> | null;
}

export interface ExportedFile {
  exportId: string;
  filename: string;
  contentType: string;
  body: Buffer;
  count: number;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

function toRow(c: CustomerRecord): ExportRow {
  return {
    phone: isAnonymizedPhone(c.phone) ? '' : c.phone,
    name: c.name,
    email: c.email,
    locale: c.locale,
    birthday: c.birthday,
    tags: c.tags,
    ordersCount: c.ordersCount,
    completedOrdersCount: c.completedOrdersCount,
    totalSpent: c.totalSpent.toJSON(),
    reservationsCount: c.reservationsCount,
    noShowCount: c.noShowCount,
    banquetsCount: c.banquetsCount,
    marketingConsent: c.marketingConsent,
    firstSeenAt: c.firstSeenAt,
    lastActivityAt: c.lastActivityAt,
  };
}

/**
 * Выгрузка гостей по фильтру или сегменту в XLSX/CSV (право customers.export).
 * Маркетинговая выгрузка — только гости с маркетинговым согласием; сервисная (purpose=service) —
 * без этого ограничения. Каждая выгрузка пишется в журнал действий (фильтр, цель, формат, число строк)
 * — защита персональных данных.
 */
@Injectable()
export class ExportCustomers {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly segments: SegmentRepository,
    private readonly xlsx: XlsxBuilder,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: ExportCustomersInput): Promise<ExportedFile> {
    actor.assertCanSomewhere(Permission.CustomersExport);
    if (!EXPORT_FORMATS.includes(input.format)) throw new ValidationError('customer_export.format_invalid', 'Format: xlsx or csv');
    if (!EXPORT_PURPOSES.includes(input.purpose)) {
      throw new ValidationError('customer_export.purpose_invalid', 'Purpose: marketing or service');
    }
    let filter = normalizeCustomerFilter(input.filter ?? {});
    if (input.segmentId) {
      const segment = await this.segments.findById(input.segmentId);
      if (!segment) throw new NotFoundError('customer_segment', input.segmentId);
      filter = mergeFilters(normalizeCustomerFilter(segment.filter), filter);
    }
    const scoped = exportFilter(input.purpose, filter);
    const records = await this.customers.listForExport(scoped, MAX_EXPORT_ROWS + 1);
    if (records.length > MAX_EXPORT_ROWS) {
      throw new ValidationError('customer_export.too_large', `Export is limited to ${MAX_EXPORT_ROWS} rows, narrow the filter`, {
        max: MAX_EXPORT_ROWS,
      });
    }
    const rows = records.map(toRow);
    const body = input.format === 'csv' ? buildCsv(rows, (d) => `${toLocalDate(d)} ${toLocalTime(d)}`) : await this.buildXlsx(rows);

    const exportId = newId();
    await this.database.transaction(() =>
      this.audit.record({
        action: 'customers.exported',
        entityType: 'customer_export',
        entityId: exportId,
        after: { format: input.format, purpose: input.purpose, segmentId: input.segmentId ?? null, filter: scoped, count: rows.length },
      }),
    );
    return {
      exportId,
      filename: exportFileName(input.purpose, input.format, toLocalDate(this.clock.now())),
      contentType: CONTENT_TYPES[input.format],
      body,
      count: rows.length,
    };
  }

  private buildXlsx(rows: ExportRow[]): Promise<Buffer> {
    return this.xlsx.build([
      {
        name: 'Гости',
        columns: EXPORT_COLUMNS.map((c) => ({
          header: c.header,
          key: c.key,
          format: c.format,
          width: c.key === 'tags' || c.key === 'email' ? 28 : 18,
        })),
        rows: rows.map((r) => ({ ...r, tags: r.tags.join(', '), marketingConsent: r.marketingConsent ? 'да' : 'нет' })),
      },
    ]);
  }
}
