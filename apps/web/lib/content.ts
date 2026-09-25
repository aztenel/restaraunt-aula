/**
 * Контент витрины для SSR: баннеры, акции, текстовые страницы, тексты согласий
 * (модули Catalog/контент и Customers), продукты подарочных сертификатов (Payments).
 * Второстепенные блоки (баннеры, акции на главной) при сбое API скрываются, а не роняют страницу.
 */
import { cache } from 'react';
import { ApiError, call } from '@aula/api-client';
import type { AppLocale } from '@/i18n/routing';
import { createServerApi } from './api';
import type {
  Banner,
  BannerPlacement,
  CertificateOrderStatus,
  CertificateProduct,
  ConsentKind,
  ConsentText,
  ContentPage,
  Promotion,
} from './api-types';

function warn(scope: string, error: unknown): void {
  console.warn(`[content] ${scope} unavailable:`, error instanceof Error ? error.message : error);
}

async function notFoundAsNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) return null;
    throw error;
  }
}

/** Баннеры места (общие + филиала). Ошибка → пустой список. */
export const getBanners = cache(
  async (locale: AppLocale, placement: BannerPlacement, branchSlug: string | null): Promise<Banner[]> => {
    try {
      const api = createServerApi({ locale, tags: ['content', 'banners'] });
      const data = await call(
        api.GET('/api/v1/public/content/banners', {
          params: { query: { placement, locale, ...(branchSlug ? { branch: branchSlug } : {}) } },
        }),
      );
      return data as unknown as Banner[];
    } catch (error) {
      warn(`banners(${placement})`, error);
      return [];
    }
  },
);

/** Действующие акции (сети + филиала, если указан). null — API недоступен. */
export const getPromotions = cache(async (locale: AppLocale, branchSlug: string | null): Promise<Promotion[] | null> => {
  try {
    const api = createServerApi({ locale, tags: ['content', 'promotions'] });
    const data = await call(
      api.GET('/api/v1/public/content/promotions', {
        params: { query: { locale, ...(branchSlug ? { branch: branchSlug } : {}) } },
      }),
    );
    return data as unknown as Promotion[];
  } catch (error) {
    warn('promotions', error);
    return null;
  }
});

/** Акция по slug. null — нет или не действует (404). */
export const getPromotion = cache(async (locale: AppLocale, slug: string): Promise<Promotion | null> => {
  const api = createServerApi({ locale, tags: ['content', 'promotions', `promotion:${slug}`] });
  return notFoundAsNull(
    call(api.GET('/api/v1/public/content/promotions/{slug}', { params: { path: { slug }, query: { locale } } })),
  ) as Promise<Promotion | null>;
});

/** Опубликованная текстовая страница. null — нет (404). */
export const getContentPage = cache(async (locale: AppLocale, slug: string): Promise<ContentPage | null> => {
  const api = createServerApi({ locale, tags: ['content', 'pages', `page:${slug}`] });
  return notFoundAsNull(call(api.GET('/api/v1/public/content/pages/{slug}', { params: { path: { slug }, query: { locale } } })));
});

/** Действующий текст согласия. null — не опубликован или API недоступен. */
export const getConsentText = cache(async (locale: AppLocale, kind: ConsentKind): Promise<ConsentText | null> => {
  try {
    const api = createServerApi({ locale, revalidate: 300, tags: ['consents', `consent:${kind}`] });
    return await call(api.GET('/api/v1/public/consents/{kind}', { params: { path: { kind }, query: { locale } } }));
  } catch (error) {
    if (!(error instanceof ApiError && error.isNotFound)) warn(`consent(${kind})`, error);
    return null;
  }
});

/** Продукты подарочных сертификатов в продаже. null — API недоступен. */
export const getCertificateProducts = cache(async (locale: AppLocale): Promise<CertificateProduct[] | null> => {
  try {
    const api = createServerApi({ locale, tags: ['certificates', 'certificate-products'] });
    return await call(api.GET('/api/v1/public/certificates/products', { params: { query: { locale } } }));
  } catch (error) {
    warn('certificate products', error);
    return null;
  }
});

/** Статус покупки сертификата — без кэша. null — заказа нет (404). */
export async function getCertificateOrder(locale: AppLocale, token: string): Promise<CertificateOrderStatus | null> {
  const api = createServerApi({ locale, revalidate: false });
  return notFoundAsNull(
    call(api.GET('/api/v1/public/certificates/orders/{token}', { params: { path: { token }, query: { locale } } })),
  ) as Promise<CertificateOrderStatus | null>;
}
