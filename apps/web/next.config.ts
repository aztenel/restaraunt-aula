import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

type RemotePattern = NonNullable<NonNullable<NextConfig['images']>['remotePatterns']>[number];

/**
 * Хосты картинок для next/image: публичные файлы API (/api/v1/files/public/...), S3/CDN.
 * Значения берутся из окружения на этапе сборки; localhost разрешён для разработки.
 */
function remotePatternFrom(raw: string | undefined): RemotePattern | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return {
      protocol: url.protocol.replace(':', '') as 'http' | 'https',
      hostname: url.hostname,
      port: url.port,
      pathname: '/**',
    };
  } catch {
    return null;
  }
}

const imageSources = [
  process.env.NEXT_PUBLIC_API_URL,
  process.env.API_PUBLIC_URL,
  process.env.S3_PUBLIC_URL,
  ...(process.env.IMAGE_HOSTS ?? '').split(','),
].map((s) => s?.trim());

const remotePatterns: RemotePattern[] = [
  { protocol: 'http', hostname: 'localhost', port: '3000', pathname: '/**' },
  { protocol: 'http', hostname: '127.0.0.1', port: '3000', pathname: '/**' },
  ...imageSources.map(remotePatternFrom).filter((p): p is RemotePattern => p !== null),
];

/** Заголовки безопасности (ТЗ: HTTPS + HSTS). CSP не задаём: GA4/Метрика/OSM-тайлы подключаются динамически. */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), payment=(self), browsing-topics=()',
  },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  // Монорепозиторий: трассировка зависимостей для standalone-сборки от корня (workspace-пакеты).
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  reactStrictMode: true,
  poweredByHeader: false,
  // @aula/api-client поставляется исходниками TypeScript.
  transpilePackages: ['@aula/api-client'],
  images: {
    remotePatterns,
    formats: ['image/avif', 'image/webp'],
    // Фото меню и контента — готовые webp-варианты API (свой loader в components/ui/ApiImage.tsx):
    // ширины srcset совпадают с вариантами, описатель ширины соответствует файлу.
    // Держать в синхроне с IMAGE_DEVICE_SIZES / IMAGE_SIZES в lib/images.ts.
    deviceSizes: [300, 600, 1200, 1920],
    imageSizes: [150],
  },
  // Линт запускается отдельно (pnpm --filter @aula/web lint) и в CI, сборку не блокирует.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const config = withNextIntl(nextConfig);

// Sentry: загрузка source maps и инструментирование сборки — только при наличии токена.
// Без токена SDK всё равно работает через instrumentation*.ts (если задан DSN).
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(config, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      telemetry: false,
      widenClientFileUpload: true,
      disableLogger: true,
    })
  : config;
