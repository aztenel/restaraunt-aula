/**
 * Орнамент «қошқар мүйіз» (бараньи рога) — сдержанный национальный акцент бренда.
 * Используется как иконка в логотипе, разделитель секций и фоновый узор героя.
 */
import clsx from 'clsx';

export function RamHorn({ className, strokeWidth = 2.2 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 64 36" className={className} fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 34V17c0-6.5-5.5-11.5-12-10.5C13.8 7.4 12.4 16 18.5 17.3c4.2.9 5.8-4.6 2.3-5.8" />
        <path d="M32 17c0-6.5 5.5-11.5 12-10.5 6.2.9 7.6 9.5 1.5 10.8-4.2.9-5.8-4.6-2.3-5.8" />
        <path d="M26 27h12" />
      </g>
    </svg>
  );
}

/** Разделитель: линия — орнамент — линия. */
export function OrnamentDivider({ className }: { className?: string }) {
  return (
    <div className={clsx('flex items-center gap-3 text-gold-500', className)} aria-hidden="true">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-gold-400/70" />
      <RamHorn className="h-5 w-9" />
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-gold-400/70" />
    </div>
  );
}

/** Повторяющийся узор для тёмного фона героя (очень низкая непрозрачность). */
export function OrnamentPattern({ className }: { className?: string }) {
  return (
    <svg className={clsx('pointer-events-none absolute inset-0 h-full w-full', className)} aria-hidden="true" focusable="false">
      <defs>
        <pattern id="aula-ornament" width="96" height="72" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M48 58V41c0-6.5-5.5-11.5-12-10.5-6.2.9-7.6 9.5-1.5 10.8 4.2.9 5.8-4.6 2.3-5.8" />
            <path d="M48 41c0-6.5 5.5-11.5 12-10.5 6.2.9 7.6 9.5 1.5 10.8-4.2.9-5.8-4.6-2.3-5.8" />
            <path d="M0 10h14M82 10h14M48 2v8" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#aula-ornament)" />
    </svg>
  );
}
