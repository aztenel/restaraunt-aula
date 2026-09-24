'use client';

import { useEffect } from 'react';
import { reportError } from '@/lib/report-error';

/** Ошибка в корневом layout: собственная разметка без зависимостей от провайдеров. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <html lang="ru">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#fbf6ee', color: '#231a13', margin: 0 }}>
        <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16, textAlign: 'center' }}>
          <div style={{ maxWidth: 420 }}>
            <p style={{ fontSize: 22, letterSpacing: '0.18em', fontWeight: 700, color: '#57351e' }}>AULA</p>
            <h1 style={{ fontSize: 24 }}>Что-то пошло не так</h1>
            <p lang="kk">Бірдеңе дұрыс болмады</p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 24,
                minHeight: 48,
                padding: '0 24px',
                borderRadius: 999,
                border: 0,
                background: '#57351e',
                color: '#fffcf7',
                fontWeight: 600,
                fontSize: 16,
                cursor: 'pointer',
              }}
            >
              Повторить · Қайталау
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
