import { ValidationError } from '../../../shared/kernel/errors';
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
