import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * robots.txt. Служебные страницы (корзина, оформление, статусы по токенам, оплата) не индексируются.
 * ROBOTS_DISALLOW_ALL=true — закрыть сайт целиком (staging).
 */
export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  if (process.env.ROBOTS_DISALLOW_ALL === 'true') {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/*/cart',
          '/*/checkout',
          '/*/orders/',
          '/*/booking/',
          '/*/banquets/quote/',
          '/*/banquets/invoice/',
          '/*/certificates/order/',
          '/*/payment/',
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
