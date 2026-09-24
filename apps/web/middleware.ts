import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Определение языка (cookie NEXT_LOCALE → Accept-Language → ru) и префикс языка в URL.
 */
export default createMiddleware(routing);

export const config = {
  // Всё, кроме API, служебных путей Next.js и файлов с расширением (sitemap.xml, robots.txt, иконки).
  matcher: ['/((?!api|_next|_vercel|monitoring|.*\\..*).*)'],
};
