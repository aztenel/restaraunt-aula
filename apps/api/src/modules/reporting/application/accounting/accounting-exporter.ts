import { Inject, Injectable } from '@nestjs/common';
import { ExternalServiceError } from '../../../../shared/infrastructure/integrations/external-http';
import { DomainError, ValidationError } from '../../../../shared/kernel/errors';
import { AccountingExportData, AccountingExportFormat } from '../../domain/accounting-export';

/**
 * Интеграция с учётом (1С) — только за интерфейсами. Формат файла — AccountingExporter
 * (адаптеры в infrastructure/adapters), отправка в HTTP-сервис учётной системы — AccountingPushGateway.
 */
export interface AccountingExportArtifact {
  body: Buffer;
  contentType: string;
  extension: string;
}

export abstract class AccountingExporter {
  abstract readonly format: AccountingExportFormat;
  abstract build(data: AccountingExportData): Promise<AccountingExportArtifact>;
}

export const ACCOUNTING_EXPORTERS = Symbol('ACCOUNTING_EXPORTERS');

@Injectable()
export class AccountingExporterRegistry {
  constructor(@Inject(ACCOUNTING_EXPORTERS) private readonly exporters: AccountingExporter[]) {}

  get(format: AccountingExportFormat): AccountingExporter {
    const exporter = this.exporters.find((e) => e.format === format);
    if (!exporter) throw new ValidationError('accounting_export.unknown_format', `Unknown export format ${format}`, { format });
    return exporter;
  }

  formats(): AccountingExportFormat[] {
    return this.exporters.map((e) => e.format);
  }
}

export interface PushFile {
  body: Buffer;
  name: string;
  contentType: string;
}

export abstract class AccountingPushGateway {
  /** Настроена и включена ли отправка в учётную систему. */
  abstract isEnabled(): Promise<boolean>;
  /** Отправить файл. Ошибка — ExternalServiceError (retryable) или доменная (настройки). */
  abstract push(file: PushFile, meta: { exportId: string; periodFrom: string; periodTo: string }): Promise<void>;
}

/** Имеет ли смысл повтор: сетевые ошибки и 5xx — да; доменные ошибки и 4xx — нет. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ExternalServiceError) return error.retryable;
  return !(error instanceof DomainError);
}

export function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}
