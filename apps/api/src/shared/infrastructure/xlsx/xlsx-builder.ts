import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

export type XlsxFormat = 'text' | 'number' | 'money' | 'percent' | 'date' | 'datetime';

export interface XlsxColumn<Row> {
  header: string;
  key: keyof Row & string;
  width?: number;
  format?: XlsxFormat;
}

export interface XlsxSheet<Row = Record<string, unknown>> {
  name: string;
  columns: XlsxColumn<Row>[];
  rows: Row[];
}

/**
 * Выгрузка отчётов в XLSX. Суммы приходят в тиынах и выводятся в тенге (формат ячейки),
 * даты — в Asia/Almaty.
 */
@Injectable()
export class XlsxBuilder {
  async build(sheets: XlsxSheet<any>[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'AULA';
    wb.created = new Date();
    for (const sheet of sheets) {
      const ws = wb.addWorksheet(sheet.name.slice(0, 31));
      ws.columns = sheet.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      for (const row of sheet.rows) {
        const values: Record<string, unknown> = {};
        for (const col of sheet.columns) {
          values[col.key] = convert(row[col.key], col.format);
        }
        ws.addRow(values);
      }
      sheet.columns.forEach((col, idx) => {
        const column = ws.getColumn(idx + 1);
        if (col.format === 'money') column.numFmt = '#,##0.00 [$₸-kk-KZ]';
        if (col.format === 'number') column.numFmt = '#,##0';
        if (col.format === 'percent') column.numFmt = '0.0%';
        if (col.format === 'date') column.numFmt = 'dd.mm.yyyy';
        if (col.format === 'datetime') column.numFmt = 'dd.mm.yyyy hh:mm';
      });
    }
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer as ArrayBuffer);
  }
}

function convert(value: unknown, format?: XlsxFormat): unknown {
  if (value === null || value === undefined) return null;
  if (format === 'money') {
    const amount = typeof value === 'object' && value !== null && 'amount' in value ? (value as { amount: number }).amount : Number(value);
    return amount / 100;
  }
  if (format === 'date' || format === 'datetime') {
    const d = value instanceof Date ? value : new Date(String(value));
    // ExcelJS пишет даты в UTC; сдвигаем на смещение Asia/Almaty, чтобы в ячейке было местное время.
    const local = new Date(d.getTime() + almatyOffsetMs(d));
    return local;
  }
  return value;
}

function almatyOffsetMs(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Almaty',
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(d);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  return asUtc - Math.floor(d.getTime() / 60_000) * 60_000;
}
