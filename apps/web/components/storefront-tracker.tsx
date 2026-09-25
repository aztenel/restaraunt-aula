'use client';

import { useEffect } from 'react';
import { usePathname } from '@/i18n/navigation';
import { trackStorefrontEvent, viewEventForPath } from '@/lib/analytics-session';
import { useCart } from '@/lib/cart';
import { RESERVED_FIRST_SEGMENTS } from '@/lib/routes';

/**
 * Просмотры страниц витрины для отчёта «Конверсия витрины в заказ» (модуль Reporting):
 * page_view / menu_view / dish_view по пути без языка + выбранный филиал. Анонимно (uuid сессии).
 */
export function StorefrontTracker() {
  const pathname = usePathname();
  const { branchId } = useCart();
  useEffect(() => {
    trackStorefrontEvent(viewEventForPath(pathname, RESERVED_FIRST_SEGMENTS), { path: pathname, branchId });
    // Филиал — контекст события, а не повод для нового просмотра.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  return null;
}
