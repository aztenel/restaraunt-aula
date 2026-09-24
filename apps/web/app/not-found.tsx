import type { Metadata } from 'next';
import { Logo } from '@/components/brand/Logo';
import { OrnamentDivider } from '@/components/brand/Ornament';
import { fontVariables } from '@/lib/fonts';

export const metadata: Metadata = {
  title: '404 — AULA',
  robots: { index: false, follow: false },
};

/** 404 для адресов вне языковых разделов (обычно такие адреса перенаправляются в /ru/...). */
export default function RootNotFound() {
  return (
    <html lang="ru" className={fontVariables}>
      <body className="grid min-h-dvh place-items-center bg-cream-100 px-4 text-center">
        <main className="max-w-md">
          <Logo className="justify-center" />
          <p className="mt-8 font-display text-6xl font-semibold text-earth-800">404</p>
          <OrnamentDivider className="mx-auto mt-4 max-w-40" />
          <h1 className="mt-4 text-2xl font-semibold text-earth-900">Страница не найдена</h1>
          <p lang="kk" className="mt-1 text-earth-700">
            Бет табылмады
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="/ru" className="inline-flex min-h-12 items-center rounded-full bg-earth-700 px-6 font-semibold text-cream-50">
              На главную
            </a>
            <a
              href="/kk"
              lang="kk"
              className="inline-flex min-h-12 items-center rounded-full border border-earth-300 px-6 font-semibold text-earth-800"
            >
              Басты бет
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
