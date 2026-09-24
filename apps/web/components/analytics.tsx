'use client';

import Script from 'next/script';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { googleAnalyticsId, yandexMetrikaId } from '@/lib/goals';

/**
 * Счётчики аналитики: GA4 (NEXT_PUBLIC_GA_ID) и Яндекс.Метрика (NEXT_PUBLIC_YM_ID).
 * Подключаются только если переменные заданы. Значения проверяются по формату — в код
 * страницы не попадает произвольная строка из окружения. Цели — lib/goals.ts (reachGoal).
 */
export function Analytics() {
  const gaId = googleAnalyticsId();
  const ymId = yandexMetrikaId();
  if (!gaId && !ymId) return null;
  return (
    <>
      {gaId ? (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${gaId}');`}
          </Script>
        </>
      ) : null}
      {ymId ? (
        <>
          <Script id="ym-init" strategy="afterInteractive">
            {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym');ym(${ymId},'init',{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:false});`}
          </Script>
          <YandexPageViews counterId={ymId} />
        </>
      ) : null}
    </>
  );
}

/** Просмотры страниц при клиентской навигации (первый просмотр Метрика считает сама). */
function YandexPageViews({ counterId }: { counterId: number }) {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.ym?.(counterId, 'hit', window.location.href, { referer: document.referrer });
  }, [pathname, counterId]);
  return null;
}
