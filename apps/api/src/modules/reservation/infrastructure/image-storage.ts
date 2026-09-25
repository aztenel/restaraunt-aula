import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { FileStorage } from '../../../shared/infrastructure/storage/file-storage';
import { ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import {
  assertImageDimensions,
  assertUploadableImage,
  ImageTarget,
  imageKey,
  ImageVariant,
  StoredImage,
  variantWidths,
} from '../domain/images';

/** Загруженный файл (multipart, в памяти). */
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

/**
 * Фото мест и фоны планов залов: проверка, поворот по EXIF, webp-варианты фиксированной ширины
 * (без увеличения), запись в публичное хранилище. Метаданные (EXIF, геотеги) не сохраняются.
 */
@Injectable()
export class ReservationImageStorage {
  private readonly logger = new Logger(ReservationImageStorage.name);

  constructor(private readonly storage: FileStorage) {}

  async store(target: ImageTarget, ownerId: string, file: UploadedImage | undefined): Promise<StoredImage> {
    assertUploadableImage(file);
    const upload = file!;
    let meta: sharp.Metadata;
    try {
      meta = await sharp(upload.buffer).metadata();
    } catch {
      throw new ValidationError('reservation.image_invalid', 'File is not a valid image');
    }
    // Размеры с учётом поворота по EXIF (ориентации 5-8 меняют стороны).
    const rotated = (meta.orientation ?? 1) >= 5;
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;
    assertImageDimensions(width, height);

    const id = newId();
    const variants: ImageVariant[] = [];
    try {
      for (const targetWidth of variantWidths(target, width!)) {
        const { data, info } = await sharp(upload.buffer)
          .rotate()
          .resize({ width: targetWidth, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer({ resolveWithObject: true });
        const key = imageKey(target, ownerId, id, info.width);
        await this.storage.put({ key, body: data, contentType: 'image/webp', visibility: 'public' });
        variants.push({ width: info.width, height: info.height, key });
      }
    } catch (err) {
      await this.remove({ id, variants });
      if (err instanceof ValidationError) throw err;
      throw new ValidationError('reservation.image_invalid', 'Cannot process image');
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
