/**
 * Скачивание файлов из API (выгрузки XLSX/CSV, отчёты): ответ openapi-fetch с parseAs: 'blob'
 * → Blob + имя файла из Content-Disposition + служебные заголовки (X-Export-Count).
 * Ошибки API приходят JSON-телом — превращаются в ApiError, как у обычных запросов.
 */
import { ApiError, toApiError } from '@aula/api-client';

export interface DownloadedFile {
  blob: Blob;
  /** Имя из Content-Disposition (filename* в UTF-8 приоритетнее filename). */
  filename: string | null;
  headers: Headers;
}

interface BlobResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

/**
 * attachment; filename="a.xlsx"; filename*=UTF-8''%D0%B0.xlsx → «а.xlsx».
 * Возвращает null, если имени нет или заголовок не разбирается.
 */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // некорректная %-последовательность — пробуем обычное имя
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/.exec(header);
  const name = (plain?.[2] ?? plain?.[1] ?? '').trim();
  return name || null;
}

/** Развернуть ответ с файлом: Blob при 2xx, иначе ApiError (включая сетевые сбои). */
export async function readFile(promise: Promise<BlobResult>): Promise<DownloadedFile> {
  let result: BlobResult;
  try {
    result = await promise;
  } catch (error) {
    throw toApiError(error);
  }
  const { response } = result;
  if (!response.ok) {
    throw ApiError.fromResponse(response.status, result.error, response.headers.get('x-request-id'));
  }
  const blob = result.data instanceof Blob ? result.data : new Blob([result.data as BlobPart]);
  return { blob, filename: filenameFromDisposition(response.headers.get('content-disposition')), headers: response.headers };
}

/** Сохранить Blob как файл (временная ссылка + клик). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Даём браузеру начать загрузку до освобождения ссылки.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Целое число из заголовка (X-Export-Count); null — заголовка нет или он некорректен. */
export function intHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
