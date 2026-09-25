import { PictureOutlined } from '@ant-design/icons';
import { Image } from 'antd';
import type { CatalogImage } from '@aula/api-client';
import { imageVariantUrl, largestImageUrl } from './image-files';

/** Миниатюра изображения каталога (узкий webp-вариант) с просмотром крупного варианта. */
export function CatalogThumb({ image, size = 48, alt }: { image: CatalogImage | null | undefined; size?: number; alt?: string }) {
  if (!image) {
    return (
      <div
        aria-hidden
        style={{
          width: size,
          height: size,
          borderRadius: 8,
          background: '#f3ebe1',
          color: '#c2a88c',
          display: 'grid',
          placeItems: 'center',
          fontSize: Math.round(size / 2.6),
          flex: 'none',
        }}
      >
        <PictureOutlined />
      </div>
    );
  }
  return (
    <Image
      src={imageVariantUrl(image, size * 2)}
      alt={alt ?? ''}
      width={size}
      height={size}
      style={{ objectFit: 'cover', borderRadius: 8, flex: 'none' }}
      preview={{ src: largestImageUrl(image) }}
    />
  );
}
