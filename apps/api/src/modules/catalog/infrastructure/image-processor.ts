import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { FileStorage } from '../../../shared/infrastructure/storage/file-storage';
import { ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import {
  assertImageDimensions,
  assertUploadableImage,
  IMAGE_VARIANT_WIDTHS,
  ImageKind,
  imageKey,
  ImageVariant,
  StoredImage,
} from '../domain/images';

/** Загруженный файл (multipart, в памяти). */
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

/**
 * Обработка изображений: проверка, поворот по EXIF, webp-варианты фиксированной ширины
 * (без увеличения), запись в публичное хранилище. Метаданные (EXIF, геотеги) не сохраняются.
 */
@Injectable()
export class ImageProcessor {
  private readonly logger = new Logger(ImageProcessor.name);

  constructor(private readonly storage: FileStorage) {}

  async store(kind: ImageKind, ownerId: string, file: UploadedImage): Promise<StoredImage> {
    assertUploadableImage(file);
    let meta: sharp.Metadata;
    try {
      meta = await sharp(file.buffer).metadata();
    } catch {
      throw new ValidationError('catalog.image_invalid', 'File is not a valid image');
    }
    // Ширина с учётом поворота по EXIF (ориентации 5-8 меняют стороны).
    const rotated = (meta.orientation ?? 1) >= 5;
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;
    assertImageDimensions(width, height);

    const id = newId();
    const targets = [...new Set(IMAGE_VARIANT_WIDTHS[kind].map((w) => Math.min(w, width!)))].sort((a, b) => b - a);
    const variants: ImageVariant[] = [];
    try {
      for (const target of targets) {
        const { data, info } = await sharp(file.buffer)
          .rotate()
          .resize({ width: target, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer({ resolveWithObject: true });
        const key = imageKey(kind, ownerId, id, info.width);
        await this.storage.put({ key, body: data, contentType: 'image/webp', visibility: 'public' });
        variants.push({ width: info.width, height: info.height, key });
      }
    } catch (err) {
      await this.remove({ id, variants });
      if (err instanceof ValidationError) throw err;
      throw new ValidationError('catalog.image_invalid', 'Cannot process image');
    }
    return { id, variants };
  }

  /** Удаление файлов (отмена загрузки при ошибке транзакции). Ошибки хранилища не пробрасываются. */
  async remove(image: StoredImage): Promise<void> {
    for (const v of image.variants) {
      try {
        await this.storage.delete(v.key, 'public');
      } catch (err) {
        this.logger.warn({ err, key: v.key }, 'Failed to delete image variant');
      }
    }
  }

  publicUrl(key: string): string {
    return this.storage.publicUrl(key);
  }
}
