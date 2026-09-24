import { Injectable } from '@nestjs/common';
import { FileStorage } from '../../../shared/infrastructure/storage/file-storage';
import { DEFAULT_IMAGE_WIDTH, ImageKind, pickVariant, StoredImage } from '../domain/images';

export interface ImageVariantView {
  width: number;
  height: number;
  url: string;
}

/** Изображение для API: url варианта по умолчанию + все варианты (srcset). */
export interface ImageView {
  id: string;
  url: string;
  width: number;
  height: number;
  variants: ImageVariantView[];
}

/** Публичные URL изображений (CDN/S3 или локальная раздача). */
@Injectable()
export class ImageUrls {
  constructor(private readonly storage: FileStorage) {}

  view(image: StoredImage | null | undefined, kind: ImageKind): ImageView | null {
    if (!image || image.variants.length === 0) return null;
    const main = pickVariant(image, DEFAULT_IMAGE_WIDTH[kind])!;
    return {
      id: image.id,
      url: this.storage.publicUrl(main.key),
      width: main.width,
      height: main.height,
      variants: [...image.variants]
        .sort((a, b) => a.width - b.width)
        .map((v) => ({ width: v.width, height: v.height, url: this.storage.publicUrl(v.key) })),
    };
  }

  url(image: StoredImage | null | undefined, kind: ImageKind): string | null {
    return this.view(image, kind)?.url ?? null;
  }
}
