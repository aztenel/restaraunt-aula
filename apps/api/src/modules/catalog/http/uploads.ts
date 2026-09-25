import { CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException } from '@nestjs/common';
import { catchError, Observable, throwError } from 'rxjs';
import { PayloadTooLargeError, ValidationError } from '../../../shared/kernel/errors';
import { MAX_IMAGE_BYTES } from '../domain/images';
import { UploadedImage } from '../infrastructure/image-processor';

/** Описание multipart-тела с одним файлом для OpenAPI. */
export const SINGLE_IMAGE_BODY = {
  schema: { type: 'object' as const, required: ['file'], properties: { file: { type: 'string' as const, format: 'binary' } } },
};

/** Описание multipart-тела с несколькими файлами для OpenAPI. */
export const MULTI_IMAGE_BODY = {
  schema: {
    type: 'object' as const,
    required: ['files'],
    properties: { files: { type: 'array' as const, items: { type: 'string' as const, format: 'binary' } } },
  },
};

export function requireImage(file: UploadedImage | undefined): UploadedImage {
  if (!file) throw new ValidationError('catalog.image_required', 'Image file is required (multipart field "file")');
  return file;
}

/**
 * Файл больше лимита отсекается multer до действия (PayloadTooLargeException) — переводим в ошибку
 * API 413 с кодом catalog.image_too_large. Ставится перед FileInterceptor/FilesInterceptor.
 */
@Injectable()
export class ImageTooLargeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) =>
        throwError(() =>
          err instanceof PayloadTooLargeException
            ? new PayloadTooLargeError('catalog.image_too_large', 'Image must be up to 10 MB', { max: MAX_IMAGE_BYTES })
            : err,
        ),
      ),
    );
  }
}
