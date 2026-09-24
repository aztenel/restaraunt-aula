import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
const PdfPrinter = require('pdfmake');

const FONTS_DIR = resolve(__dirname, '..', '..', '..', 'assets', 'fonts');

/**
 * Генерация PDF (сметы, счета, договоры, акты, сертификаты). Шрифт DejaVu Sans —
 * поддерживает кириллицу и казахские буквы (ә, ғ, қ, ң, ө, ұ, ү, һ, і).
 */
@Injectable()
export class PdfRenderer {
  private readonly printer = new PdfPrinter({
    DejaVu: {
      normal: join(FONTS_DIR, 'DejaVuSans.ttf'),
      bold: join(FONTS_DIR, 'DejaVuSans-Bold.ttf'),
      italics: join(FONTS_DIR, 'DejaVuSans.ttf'),
      bolditalics: join(FONTS_DIR, 'DejaVuSans-Bold.ttf'),
    },
  });

  async render(definition: TDocumentDefinitions): Promise<Buffer> {
    const doc = this.printer.createPdfKitDocument({
      pageSize: 'A4',
      pageMargins: [40, 50, 40, 50],
      ...definition,
      defaultStyle: { font: 'DejaVu', fontSize: 10, ...(definition.defaultStyle ?? {}) },
    });
    return new Promise<Buffer>((resolvePromise, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }
}

/** Фирменная шапка документов AULA. Реквизиты передаёт вызывающий модуль. */
export function brandHeader(input: { brand: string; subtitle?: string; lines?: string[] }): Content {
  return {
    columns: [
      { text: input.brand, style: 'brand', width: '*' },
      {
        width: 'auto',
        stack: [input.subtitle ? { text: input.subtitle, bold: true } : '', ...(input.lines ?? []).map((l) => ({ text: l, fontSize: 8 }))],
        alignment: 'right',
      },
    ],
    margin: [0, 0, 0, 16],
  };
}

export const PDF_STYLES = {
  brand: { fontSize: 22, bold: true, color: '#7a4b2a' },
  h1: { fontSize: 16, bold: true, margin: [0, 8, 0, 8] },
  h2: { fontSize: 12, bold: true, margin: [0, 8, 0, 4] },
  muted: { color: '#666666', fontSize: 8 },
  tableHeader: { bold: true, fillColor: '#f1e7dc' },
  total: { bold: true, fontSize: 12 },
} as const;
